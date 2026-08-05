# Cannons Auctions API

A REST API integration for [Cannons Auctions](https://bid.cannonsauctions.com) that provides structured access to auction data including item search, auction listings, and detailed item information.

## MCP (Model Context Protocol)

This API is also available as an MCP server for Claude Code, enabling natural language access to auction data directly from Claude.

### Installation

**Globally (recommended):**
```bash
# Create the global MCP config directory if it doesn't exist
mkdir -p ~/.claude

# Add the MCP server to your global config
cat > ~/.claude/.mcp.json << 'EOF'
{
  "mcpServers": {
    "cannons-auctions-mcp": {
      "command": "node",
      "args": ["./mcp/server.js"]
    }
  }
}
EOF
```

**Per-project:**
The `mcp/` directory and `.mcp.json` are included in the repo. From the project directory, Claude Code will automatically detect the MCP server.

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `search_auctions` | Search auction items with filters, pagination, and price range |
| `list_auctions` | List current auctions with pagination |
| `get_auction_items` | Get all items in a specific auction |
| `get_item_details` | Get detailed information about a specific auction item |

### Usage Example

```
User: Find all items in the current auction with "chair" in the title
Claude: Uses get_auction_items with search="chair" to return matching items

User: What's the current bid on lot 165?
Claude: Uses search_auctions to find lot 165, returns currentBid
```

## Overview

The Cannons Auctions API provides programmatic access to auction inventory, enabling:
- Full-text search across auction items
- Browsing current, past, and upcoming auctions
- Retrieving detailed item information including descriptions and images
- Integration with existing applications and workflows

## Quick Start

```bash
# Install dependencies
npm install

# Start the server
node server.js

# Server runs on http://localhost:1337
```

## API Endpoints

### Health Check
```
GET /health
```
Returns server status and timestamp.

### Search Auction Items
```
GET /api/search?search=keyword&filter=Current&sortBy=enddate_asc&page=1&pagesize=100
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `search` | string | `""` | Search term (empty = all items) |
| `filter` | string | `Current` | Auction filter: `Current`, `Past`, `Future` |
| `sortBy` | string | `""` | Sort order: `enddate_asc`, `enddate_desc`, `ordernumber_asc`, `ordernumber_desc` |
| `page` | integer | `1` | Page number |
| `pagesize` | integer | `100` | Items per page (max 100) |
| `minBid` | number | `null` | Minimum bid filter (e.g., 10) |
| `maxBid` | number | `null` | Maximum bid filter (e.g., 100) |
| `sanitize` | boolean | `false` | Normalize text for better matching (lowercase, remove punctuation) |

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "lotNumber": "165",
        "title": "Lot 165",
        "description": null,
        "auctionTitle": "08/04/26: Part 1!! New Kent Online Estate Auction | Aga's Consignments LLC | Providence Forge VA 23140",
        "currentBid": 8,
        "endDate": "2026-08-04T21:16:47.000Z",
        "images": ["https://..."],
        "thumbnail": "https://...",
        "detailUrl": "https://bid.cannonsauctions.com/...",
        "ids": {
          "itemId": "base64-encoded-id",
          "auctionId": "base64-encoded-id",
          "pageNumber": "base64-encoded",
          "pageSize": "base64-encoded"
        }
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 1,
      "totalItems": 60,
      "itemsPerPage": 100
    }
  }
}
```

### List Current Auctions
```
GET /api/auctions?page=1&pagesize=20
```

Returns auctions grouped by event with item counts and bid ranges.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | integer | `1` | Page number |
| `pagesize` | integer | `20` | Auctions per page (max 100) |

**Response:**
```json
{
  "success": true,
  "data": {
    "auctions": [
      {
        "title": "08/04/26: Part 1!! New Kent Online Estate Auction | Aga's Consignments LLC | Providence Forge VA 23140",
        "endDate": "2026-08-04T21:00:00.000Z",
        "itemCount": 100,
        "auctionId": "base64-encoded-id",
        "bidRange": { "min": 31, "max": 210 }
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 1,
      "totalItems": 5,
      "itemsPerPage": 20
    }
  }
}
```

### Get Auction Items
```
GET /api/auctions/:auctionId/items?page=1&pagesize=100
```

Returns all items for a specific auction.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `auctionId` | string | required | Auction identifier |
| `page` | integer | `1` | Page number |
| `pagesize` | integer | `100` | Items per page (max 100) |
| `search` | string | `""` | Search term to filter items within auction |
| `sanitize` | boolean | `false` | Normalize text for better matching (lowercase, remove punctuation) |

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [...],
    "pagination": {
      "currentPage": 1,
      "totalPages": 10,
      "totalItems": 1000,
      "itemsPerPage": 100
    }
  }
}
```

### Get Item Details
```
GET /api/item/:itemId/:auctionId?pageNumber=&pageSize=
```

Retrieves detailed information for a specific auction item.

| Parameter | Type | Description |
|-----------|------|-------------|
| `itemId` | string | Item identifier (from search results) |
| `auctionId` | string | Auction identifier (from search results) |
| `pageNumber` | string | Optional pagination context |
| `pageSize` | string | Optional pagination context |

**Response:**
```json
{
  "success": true,
  "data": {
    "lotNumber": "100",
    "title": "Plaster 34\" Sculpture of \"Water of Life\" Female Figure",
    "description": "Plaster 34\" Sculpture of \"Water of Life\" Female Figure",
    "category": "Decorative",
    "quantity": 1,
    "startingBid": 13,
    "currentBid": 11,
    "endDate": "2026-08-04T21:00:00.000Z",
    "images": [
      "https://s3.amazonaws.com/prod.maxanet.auction/Can399/Inventory32697260/100_a-3035839a-5a4a-40c5-bad7-cd5117535fb3.jpg"
    ],
    "auctionTitle": ""
  }
}
```

### API Documentation (Swagger)
```
GET /api-docs
```

Interactive Swagger UI with all endpoints documented and testable.

## Examples

### Search for items
```bash
curl "http://localhost:1337/api/search?search=plate"
```

### Get all current auctions
```bash
curl "http://localhost:1337/api/auctions"
```

### Get item details
```bash
curl "http://localhost:1337/api/item/{itemId}/{auctionId}?pageNumber={pageNumber}&pageSize={pageSize}"
```

### Filter by auction status
```bash
# Past auctions
curl "http://localhost:1337/api/search?filter=Past&page=1"

# Future auctions
curl "http://localhost:1337/api/search?filter=Future&page=1"
```

### Sort results
```bash
# By end date (ascending - ending soonest first)
curl "http://localhost:1337/api/search?sortBy=enddate_asc"

# By end date (descending)
curl "http://localhost:1337/api/search?sortBy=enddate_desc"

# By lot number
curl "http://localhost:1337/api/search?sortBy=ordernumber_asc"
```

### Filter by price range
```bash
# Items with bids between $10 and $50
curl "http://localhost:1337/api/search?minBid=10&maxBid=50"

# Items with minimum bid of $100
curl "http://localhost:1337/api/search?minBid=100"

# Items with maximum bid of $25
curl "http://localhost:1337/api/search?maxBid=25"
```

## Architecture

### Components

1. **Express Server** - Handles HTTP requests and routes to appropriate handlers
2. **Data Transformation Layer** - Transforms Cannons data into consistent JSON structures
3. **Session Management** - Manages session state for API requests
4. **HTML Parser** - Uses Cheerio to parse and extract auction data

### Key Files

- `server.js` - Main Express server with all API endpoints
- `package.json` - Dependencies

## Environment

- **Node.js** 14+ required
- **Port**: 3000 (configurable via `PORT` environment variable)

## Dependencies

| Package | Purpose |
|---------|---------|
| `express` | Web server framework |
| `axios` | HTTP client |
| `cheerio` | HTML parsing and data extraction |
| `cors` | Cross-origin resource sharing |
| `swagger-ui-express` | API documentation UI |
| `swagger-jsdoc` | OpenAPI specification generation |

## License

This is free and unencumbered software released into the public domain. See UNLICENSE for details.
