import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const CANNONS_API = process.env.CANNONS_API_URL || 'http://localhost:1337';

/**
 * Fetch from the Cannons API
 */
async function cannonFetch(path) {
  const url = `${CANNONS_API}${path}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Cannons API error: ${response.status}`);
  }
  return response.json();
}

/**
 * Search auction items
 */
async function searchAuctions(args) {
  const params = new URLSearchParams();
  if (args.search) params.set('search', args.search);
  if (args.filter) params.set('filter', args.filter);
  if (args.sortBy) params.set('sortBy', args.sortBy);
  if (args.page) params.set('page', args.page.toString());
  if (args.pagesize) params.set('pagesize', args.pagesize.toString());
  if (args.minBid) params.set('minBid', args.minBid.toString());
  if (args.maxBid) params.set('maxBid', args.maxBid.toString());
  if (args.sanitize) params.set('sanitize', 'true');

  return cannonFetch(`/api/search?${params}`);
}

/**
 * List current auctions
 */
async function listAuctions(args) {
  const params = new URLSearchParams();
  if (args.page) params.set('page', args.page.toString());
  if (args.pagesize) params.set('pagesize', args.pagesize.toString());

  return cannonFetch(`/api/auctions?${params}`);
}

/**
 * Get auction items
 */
async function getAuctionItems(auctionId, args) {
  const params = new URLSearchParams();
  if (args.page) params.set('page', args.page.toString());
  if (args.pagesize) params.set('pagesize', args.pagesize.toString());
  if (args.search) params.set('search', args.search);
  if (args.sanitize) params.set('sanitize', 'true');

  return cannonFetch(`/api/auctions/${auctionId}/items?${params}`);
}

/**
 * Get item details
 */
async function getItemDetails(itemId, auctionId, pageNumber, pageSize) {
  const params = new URLSearchParams();
  if (pageNumber) params.set('pageNumber', pageNumber);
  if (pageSize) params.set('pageSize', pageSize);

  const query = params.toString() ? `?${params}` : '';
  return cannonFetch(`/api/item/${itemId}/${auctionId}${query}`);
}

/**
 * Create the MCP server
 */
const server = new Server(
  {
    name: 'cannons-auctions-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/**
 * List available tools
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'search_auctions',
        description: 'Search auction items with filters, pagination, and price range',
        inputSchema: {
          type: 'object',
          properties: {
            search: { type: 'string', description: 'Search term' },
            filter: { type: 'string', enum: ['Current', 'Past', 'Future'], description: 'Auction filter' },
            sortBy: { type: 'string', description: 'Sort order (enddate_asc, enddate_desc, ordernumber_asc, ordernumber_desc)' },
            page: { type: 'number', description: 'Page number' },
            pagesize: { type: 'number', description: 'Items per page (max 100)' },
            minBid: { type: 'number', description: 'Minimum bid filter' },
            maxBid: { type: 'number', description: 'Maximum bid filter' },
            sanitize: { type: 'boolean', description: 'Normalize text for better matching' },
          },
        },
      },
      {
        name: 'list_auctions',
        description: 'List current auctions with pagination',
        inputSchema: {
          type: 'object',
          properties: {
            page: { type: 'number', description: 'Page number' },
            pagesize: { type: 'number', description: 'Auctions per page (max 100)' },
          },
        },
      },
      {
        name: 'get_auction_items',
        description: 'Get all items in a specific auction',
        inputSchema: {
          type: 'object',
          properties: {
            auctionId: { type: 'string', description: 'The auction ID (from list_auctions)' },
            page: { type: 'number', description: 'Page number' },
            pagesize: { type: 'number', description: 'Items per page (max 100)' },
            search: { type: 'string', description: 'Search term to filter items' },
            sanitize: { type: 'boolean', description: 'Normalize text for better matching' },
          },
          required: ['auctionId'],
        },
      },
      {
        name: 'get_item_details',
        description: 'Get detailed information about a specific auction item including description',
        inputSchema: {
          type: 'object',
          properties: {
            itemId: { type: 'string', description: 'The item ID (from search or get_auction_items)' },
            auctionId: { type: 'string', description: 'The auction ID' },
            pageNumber: { type: 'string', description: 'Page number from search results (recommended)' },
            pageSize: { type: 'string', description: 'Page size from search results (recommended)' },
          },
          required: ['itemId', 'auctionId'],
        },
      },
    ],
  };
});

/**
 * Handle tool calls
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;

    switch (name) {
      case 'search_auctions':
        result = await searchAuctions(args || {});
        break;

      case 'list_auctions':
        result = await listAuctions(args || {});
        break;

      case 'get_auction_items':
        result = await getAuctionItems(args.auctionId, args || {});
        break;

      case 'get_item_details':
        result = await getItemDetails(args.itemId, args.auctionId, args.pageNumber, args.pageSize);
        break;

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

/**
 * Start the server
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Cannons Auctions MCP server running on stdio');
}

main().catch(console.error);
