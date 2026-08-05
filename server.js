require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');

const app = express();
const PORT = process.env.PORT || 1337;

app.use(cors());
app.use(express.json());

const BASE_URL = 'https://bid.cannonsauctions.com';

// Cache the session cookie for reuse
let sessionCookie = null;
let lastCookieFetch = 0;
const COOKIE_MAX_AGE = 15 * 60 * 1000; // 15 minutes

// Swagger configuration
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'cannons-auctions-api',
      version: '1.0.0',
      description: 'REST API for querying Cannons Auctions - scrapes and transforms the cannonsauctions.com public auction data into structured JSON responses.',
    },
    servers: [
      { url: `http://localhost:${PORT}`, description: 'Local development server' }
    ],
  },
  apis: ['./server.js'],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check endpoint
 *     responses:
 *       200:
 *         description: Server is healthy
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * @swagger
 * /api/search:
 *   get:
 *     summary: Search auction items
 *     description: Search for auction items with optional filters. Returns paginated results with item details including lot number, title, current bid, end date, and images.
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search term to filter items (empty returns all)
 *         example: ""
 *       - in: query
 *         name: filter
 *         schema:
 *           type: string
 *           enum: [Current, Past, Future]
 *         default: Current
 *         description: Auction time filter
 *         example: Current
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *         description: Sort order (e.g., enddate_asc, enddate_desc, ordernumber_asc, ordernumber_desc)
 *         example: enddate_asc
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: pagesize
 *         schema:
 *           type: integer
 *           default: 100
 *         description: Number of items per page (max 100)
 *     responses:
 *       200:
 *         description: Search results with pagination info
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     items:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           lotNumber:
 *                             type: string
 *                           title:
 *                             type: string
 *                           auctionTitle:
 *                             type: string
 *                           currentBid:
 *                             type: number
 *                           endDate:
 *                             type: string
 *                             format: date-time
 *                           images:
 *                             type: array
 *                             items:
 *                               type: string
 *                           thumbnail:
 *                             type: string
 *                           detailUrl:
 *                             type: string
 *                           ids:
 *                             type: object
 *                             properties:
 *                               itemId:
 *                                 type: string
 *                               auctionId:
 *                                 type: string
 *                               pageNumber:
 *                                 type: string
 *                               pageSize:
 *                                 type: string
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         currentPage:
 *                           type: integer
 *                         totalPages:
 *                           type: integer
 *                         totalItems:
 *                           type: integer
 *                         itemsPerPage:
 *                           type: integer
 *       500:
 *         description: Error fetching data from Cannons
 */
app.get('/api/search', async (req, res) => {
  try {
    const { search, filter, sortBy, page, pagesize, minBid, maxBid, sanitize } = req.query;

    const html = await fetchSearchResults({
      search: search || '',
      filter: filter || 'Current',
      sortBy: sortBy || '',
      page: parseInt(page) || 1,
      pagesize: parseInt(pagesize) || 100
    });

    let results = parseSearchResults(html);

    // Filter by price range if specified
    if (minBid !== undefined || maxBid !== undefined) {
      const min = minBid !== undefined ? parseFloat(minBid) : null;
      const max = maxBid !== undefined ? parseFloat(maxBid) : null;

      results.items = results.items.filter(item => {
        if (item.currentBid === null) return false;
        if (min !== null && item.currentBid < min) return false;
        if (max !== null && item.currentBid > max) return false;
        return true;
      });
      results.pagination.totalItems = results.items.length;
      results.pagination.totalPages = Math.ceil(results.items.length / 100);
    }

    // Sanitize titles for better matching if requested
    if (sanitize === 'true' || sanitize === '1') {
      const normalizedSearch = (search || '').toLowerCase().replace(/[^\w\s]/g, '');

      results.items = results.items.filter(item => {
        const normalizedTitle = (item.title || '').toLowerCase().replace(/[^\w\s]/g, '');
        const normalizedDesc = (item.description || '').toLowerCase().replace(/[^\w\s]/g, '');
        return normalizedTitle.includes(normalizedSearch) || normalizedDesc.includes(normalizedSearch);
      });
      results.pagination.totalItems = results.items.length;
      results.pagination.totalPages = Math.ceil(results.items.length / 100);
    }

    res.json({
      success: true,
      data: results
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/auctions:
 *   get:
 *     summary: List current auctions
 *     description: Returns a summary of all current auctions grouped by auction event, with item counts and end dates.
 *     responses:
 *       200:
 *         description: List of auctions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     auctions:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           title:
 *                             type: string
 *                           endDate:
 *                             type: string
 *                             format: date-time
 *                           itemCount:
 *                             type: integer
 *                     total:
 *                       type: integer
 *       500:
 *         description: Error fetching data from Cannons
 */
app.get('/api/auctions', async (req, res) => {
  try {
    const { page = 1, pagesize = 20 } = req.query;
    const pageNum = parseInt(page);
    const pageSizeNum = Math.min(parseInt(pagesize) || 20, 100);

    // Fetch all search results across pages to group by auction
    // First get the total count
    const firstPageHtml = await fetchSearchResults({
      search: '',
      filter: 'Current',
      sortBy: 'enddate_asc',
      page: 1,
      pagesize: 100
    });
    const firstResults = parseSearchResults(firstPageHtml);
    const totalItems = firstResults.pagination.totalItems;
    const totalPages = Math.ceil(totalItems / 100);

    // Fetch all pages to get complete auction list
    const allItems = [...firstResults.items];
    for (let p = 2; p <= Math.min(totalPages, 10); p++) {
      const html = await fetchSearchResults({
        search: '',
        filter: 'Current',
        sortBy: 'enddate_asc',
        page: p,
        pagesize: 100
      });
      const results = parseSearchResults(html);
      allItems.push(...results.items);
    }

    // Group by auction title
    const auctionMap = new Map();
    allItems.forEach(item => {
      const title = item.auctionTitle;
      if (!auctionMap.has(title)) {
        auctionMap.set(title, {
          title,
          endDate: item.endDate,
          itemCount: 0,
          minBid: item.currentBid,
          maxBid: item.currentBid,
          auctionId: item.ids.auctionId
        });
      }
      const auction = auctionMap.get(title);
      auction.itemCount++;
      if (item.currentBid !== null) {
        auction.minBid = Math.min(auction.minBid || Infinity, item.currentBid);
        auction.maxBid = Math.max(auction.maxBid || 0, item.currentBid);
      }
    });

    const auctions = [];
    auctionMap.forEach((auction) => {
      auctions.push({
        title: auction.title,
        endDate: auction.endDate,
        itemCount: auction.itemCount,
        auctionId: auction.auctionId,
        bidRange: auction.minBid && auction.maxBid ? {
          min: auction.minBid,
          max: auction.maxBid
        } : null
      });
    });

    // Sort by end date
    auctions.sort((a, b) => new Date(a.endDate || 0) - new Date(b.endDate || 0));

    // Paginate
    const startIndex = (pageNum - 1) * pageSizeNum;
    const paginatedAuctions = auctions.slice(startIndex, startIndex + pageSizeNum);

    res.json({
      success: true,
      data: {
        auctions: paginatedAuctions,
        pagination: {
          currentPage: pageNum,
          totalPages: Math.ceil(auctions.length / pageSizeNum),
          totalItems: auctions.length,
          itemsPerPage: pageSizeNum
        }
      }
    });
  } catch (error) {
    console.error('Auctions error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/auctions/{auctionId}/items:
 *   get:
 *     summary: Get all items in an auction
 *     description: Returns all items for a specific auction by auctionId
 *     parameters:
 *       - in: path
 *         name: auctionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Base64-encoded auction ID
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: pagesize
 *         schema:
 *           type: integer
 *           default: 100
 *         description: Items per page (max 100)
 *     responses:
 *       200:
 *         description: Auction items
 *       500:
 *         description: Error fetching auction items
 */
app.get('/api/auctions/:auctionId/items', async (req, res) => {
  try {
    const { auctionId } = req.params;
    const { page = 1, pagesize = 100, search, sanitize } = req.query;

    const html = await fetchSearchResults({
      search: search || '',
      filter: 'Current',
      sortBy: 'ordernumber_asc',
      page: parseInt(page),
      pagesize: parseInt(pagesize),
      auctionId: auctionId
    });

    let results = parseSearchResults(html);

    // Filter to only items from this auction
    results.items = results.items.filter(item => item.ids.auctionId === auctionId);

    // Sanitize titles for better matching if requested
    if (sanitize === 'true' || sanitize === '1') {
      const normalizedSearch = (search || '').toLowerCase().replace(/[^\w\s]/g, '');

      results.items = results.items.filter(item => {
        const normalizedTitle = (item.title || '').toLowerCase().replace(/[^\w\s]/g, '');
        const normalizedDesc = (item.description || '').toLowerCase().replace(/[^\w\s]/g, '');
        return normalizedTitle.includes(normalizedSearch) || normalizedDesc.includes(normalizedSearch);
      });
      results.pagination.totalItems = results.items.length;
      results.pagination.totalPages = Math.ceil(results.items.length / 100);
    }

    res.json({
      success: true,
      data: results
    });
  } catch (error) {
    console.error('Auction items error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/item/{itemId}/{auctionId}:
 *   get:
 *     summary: Get single item details with full description
 *     description: Fetch detailed information about a specific auction item including the full description
 *     parameters:
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema:
 *           type: string
 *         description: Base64-encoded auction item ID
 *       - in: path
 *         name: auctionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Base64-encoded auction ID
 *       - in: query
 *         name: pageNumber
 *         schema:
 *           type: string
 *         description: Page number for pagination context
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: string
 *         description: Page size for pagination context
 *     responses:
 *       200:
 *         description: Item details including description, price, images, and lot info
 *       500:
 *         description: Error fetching item details
 */
app.get('/api/item/:itemId/:auctionId', async (req, res) => {
  try {
    const { itemId, auctionId } = req.params;
    const { pageNumber, pageSize } = req.query;

    const { cookie, token } = await getSessionCookie();

    const queryParams = new URLSearchParams({
      pageNumber: pageNumber || '',
      pageSize: pageSize || '',
      AuctionItemId: itemId,
      AuctionId: auctionId
    });

    const response = await axios.get(
      `${BASE_URL}/Public/Auction/AuctionItemDetail?${queryParams}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:152.0) Gecko/20100101 Firefox/152.0',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cookie': cookie,
          ...(token && { '__RequestVerificationToken': token })
        }
      }
    );

    const itemDetail = parseItemDetail(response.data);

    res.json({
      success: true,
      data: itemDetail
    });
  } catch (error) {
    console.error('Item detail error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Parse item detail page HTML to extract structured data
 */
function parseItemDetail(html) {
  const $ = cheerio.load(html);

  // Extract description from hidden input or meta tag
  let description = '';
  const hdnDesc = $('#hdn_Description').val();
  if (hdnDesc) {
    description = hdnDesc.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  } else {
    const metaDesc = $('meta[property="og:description"]').attr('content');
    if (metaDesc) description = metaDesc;
  }

  // Extract lot number
  let lotNumber = '';
  const lotText = $('.item-detail-lot').first().text() || '';
  const lotMatch = lotText.match(/Lot\s*#?\s*(\d+)/i);
  if (lotMatch) lotNumber = lotMatch[1];

  // Extract title
  const title = $('.item-detail-title').first().text().trim() ||
                $('h1').first().text().trim() ||
                description;

  // Extract category and quantity from category-info spans
  let category = '';
  let quantity = null;
  $('.category-info').each((_, el) => {
    const text = $(el).text().trim();
    if (text.startsWith('Category :')) {
      category = text.replace('Category :', '').trim();
    } else if (text.startsWith('Qty :')) {
      const qtyMatch = text.match(/Qty\s*:\s*(\d+)/i);
      if (qtyMatch) quantity = parseInt(qtyMatch[1]);
    }
  });

  // Extract starting bid from hidden input (value="13" format)
  let startingBid = null;
  const minBidVal = $('#MinimumNextBidAmount').val();
  if (minBidVal) {
    startingBid = parseFloat(minBidVal);
  }

  // Extract current bid from hidden input
  let currentBid = null;
  const currentBidVal = $('#CurrentBidAmount').val();
  if (currentBidVal) {
    currentBid = parseFloat(currentBidVal);
  }

  // Extract images
  const images = [];
  $('.item-detail-images img, .carousel-item img').each((_, img) => {
    const src = $(img).attr('src');
    if (src && !src.includes('arrow') && !src.includes('placeholder')) {
      const fullSrc = src.replace(/-100x100\.jpg$/, '.jpg').replace(/\/100\//, '/1600/');
      if (!images.includes(fullSrc)) images.push(fullSrc);
    }
  });

  // Extract end date
  let endDate = null;
  const dateText = $('.local-date-time').first().data('auc-date');
  if (dateText) endDate = new Date(dateText).toISOString();

  // Extract auction title
  const auctionTitle = $('.breadcrumb-auction-title').first().text().trim();

  return {
    lotNumber,
    title: title || `Lot ${lotNumber}`,
    description,
    category,
    quantity,
    startingBid,
    currentBid,
    endDate,
    images,
    auctionTitle
  };
}

/**
 * Get a valid session cookie from Cannons
 */
async function getSessionCookie() {
  const now = Date.now();
  if (sessionCookie && (now - lastCookieFetch) < COOKIE_MAX_AGE) {
    return sessionCookie;
  }

  try {
    const response = await axios.get(`${BASE_URL}/Public/GlobalSearch`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:152.0) Gecko/20100101 Firefox/152.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });

    const setCookie = response.headers['set-cookie'];
    if (setCookie) {
      sessionCookie = setCookie.map(c => c.split(';')[0]).join('; ');
      lastCookieFetch = now;
    }

    const $ = cheerio.load(response.data);
    const token = $('input[name="__RequestVerificationToken"]').val();

    return { cookie: sessionCookie, token };
  } catch (error) {
    console.error('Error getting session cookie:', error.message);
    throw error;
  }
}

/**
 * Fetch search results HTML from Cannons API
 */
async function fetchSearchResults(params) {
  const { search = '', filter = 'Current', sortBy = '', page = 1, pagesize = 100, auctionId } = params;

  const { cookie, token } = await getSessionCookie();

  const queryParams = new URLSearchParams({
    pageNumber: page,
    pagesize: pagesize,
    filter: filter,
    sortBy: sortBy,
    search: search,
    _: Date.now()
  });

  if (auctionId) {
    queryParams.append('auctionId', auctionId);
  }

  try {
    const response = await axios.get(
      `${BASE_URL}/Public/GlobalSearch/GetGlobalSearchResults?${queryParams}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:152.0) Gecko/20100101 Firefox/152.0',
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'X-Requested-With': 'XMLHttpRequest',
          'Cookie': cookie,
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'same-origin',
          ...(token && { '__RequestVerificationToken': token })
        }
      }
    );

    return response.data;
  } catch (error) {
    console.error('Error fetching search results:', error.message);
    throw error;
  }
}

/**
 * Parse the HTML response into structured JSON
 */
function parseSearchResults(html) {
  const $ = cheerio.load(html);
  const items = [];

  // Get total count from "Showing X - Y of Z entries"
  const showingText = $('.show-enteries').text().trim();
  const totalMatch = showingText.match(/of\s+([\d,]+)/);
  const total = totalMatch ? parseInt(totalMatch[1].replace(/,/g, '')) : 0;

  // Get current page from pagination
  const currentPageMatch = $('.pagination .page-item.active a').text().trim();
  const currentPage = parseInt(currentPageMatch) || 1;

  const totalPages = Math.ceil(total / 100);

  // Parse each lot item - look for items with lot numbers
  $('.bg-white.border').each((_, lotElement) => {
    const $lot = $(lotElement);

    // Extract lot number from linkbuttons span
    const lotText = $lot.find('.linkbuttons').first().text();
    const lotMatch = lotText.match(/Lot\s*-\s*(\d+)/i);
    const lotNumber = lotMatch ? lotMatch[1] : null;

    if (!lotNumber) return;

    // Get auction title - look for the h4 that contains "Auction :"
    const auctionTitle = $('h4').filter((_, el) => $(el).text().includes('Auction :')).first().text().replace('Auction :', '').trim();

    // Extract item title (may be empty)
    const itemTitle = $lot.find('.auction-Itemlist-Title a').text().trim();

    // Extract current bid
    const bidText = $lot.find('.font-1rem').text();
    const bidMatch = bidText.match(/Current Bid\s*:\s*([\d,.]+)/);
    const currentBid = bidMatch ? parseFloat(bidMatch[1].replace(/,/g, '')) : null;

    // Extract end date
    const endDateStr = $lot.find('.local-date-time').data('auc-date');
    const endDate = endDateStr ? new Date(endDateStr) : null;

    // Extract image URLs
    const images = [];
    $lot.find('.carousel-item img').each((_, img) => {
      const src = $(img).attr('src');
      if (src && !src.includes('arrow-angel') && !src.includes('placeholder')) {
        const fullSrc = src.replace(/-100x100\.jpg$/, '.jpg');
        images.push(fullSrc);
      }
    });

    // Extract detail URL and IDs
    const detailLink = $lot.find('.Auction-item-list a').first().attr('href');
    let itemId = null;
    let auctionId = null;
    let pageNumber = null;
    let pageSize = null;

    if (detailLink) {
      const urlParams = new URLSearchParams(detailLink.split('?')[1]);
      itemId = urlParams.get('AuctionItemId');
      auctionId = urlParams.get('AuctionId');
      pageNumber = urlParams.get('pageNumber');
      pageSize = urlParams.get('pageSize');
    }

    // Extract thumbnail
    const thumbnail = $lot.find('.carousel-item.active img').attr('src') || null;

    items.push({
      lotNumber,
      title: itemTitle || `Lot ${lotNumber}`,
      description: null, // Description only available on item detail page
      auctionTitle: auctionTitle || 'Unknown Auction',
      currentBid,
      endDate: endDate ? endDate.toISOString() : null,
      images,
      thumbnail,
      detailUrl: detailLink ? `${BASE_URL}${detailLink}` : null,
      ids: {
        itemId,
        auctionId,
        pageNumber,
        pageSize
      }
    });
  });

  return {
    items,
    pagination: {
      currentPage,
      totalPages,
      totalItems: total,
      itemsPerPage: 100
    }
  };
}

app.listen(PORT, () => {
  console.log(`Cannons API running on http://localhost:${PORT}`);
  console.log(`API Docs: http://localhost:${PORT}/api-docs`);
  console.log(`Search: GET /api/search?search=&filter=Current&sortBy=enddate_asc&page=1`);
  console.log(`Auctions: GET /api/auctions`);
  console.log(`Item: GET /api/item/:itemId/:auctionId`);
});
