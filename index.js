

const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;


app.use(cors());
app.use(express.json());


const cache = new Map();
const CACHE_DURATION = 5 * 60 * 1000;



async function fetchWithRetry(url, retries = 3, delay = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url);
            if (response.ok) {
                return await response.json();
            }
            if (response.status === 429) {
                // Rate limited, tunggu lebih lama
                await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
                continue;
            }
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        } catch (error) {
            if (i === retries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

function getCached(key) {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        return cached.data;
    }
    cache.delete(key);
    return null;
}

function setCache(key, data) {
    cache.set(key, {
        data,
        timestamp: Date.now()
    });
}




app.get('/api/gamepass/:id', async (req, res) => {
    try {
        const gamepassId = req.params.id;
        
        // Validasi ID
        if (!/^\d+$/.test(gamepassId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid gamepass ID'
            });
        }

        
        const cacheKey = `gamepass_${gamepassId}`;
        const cached = getCached(cacheKey);
        if (cached) {
            return res.json({
                success: true,
                data: cached,
                cached: true
            });
        }

       
        const url = `https://apis.roblox.com/game-passes/v1/game-passes/${gamepassId}/product-info`;
        const data = await fetchWithRetry(url);

        const result = {
            id: gamepassId,
            name: data.Name || 'Unknown',
            description: data.Description || '',
            price: data.PriceInRobux || 0,
            isForSale: data.IsForSale || false,
            created: data.Created || null,
            updated: data.Updated || null
        };

       
        setCache(cacheKey, result);

        res.json({
            success: true,
            data: result,
            cached: false
        });

    } catch (error) {
        console.error('Error fetching gamepass:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


app.post('/api/gamepass/batch', async (req, res) => {
    try {
        const { ids } = req.body;

        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid IDs array'
            });
        }

        if (ids.length > 20) {
            return res.status(400).json({
                success: false,
                error: 'Maximum 20 IDs per request'
            });
        }

        const results = [];
        const errors = [];

        for (const id of ids) {
            try {
                const cacheKey = `gamepass_${id}`;
                let data = getCached(cacheKey);

                if (!data) {
                    const url = `https://apis.roblox.com/game-passes/v1/game-passes/${id}/product-info`;
                    const apiData = await fetchWithRetry(url);
                    
                    data = {
                        id: id,
                        name: apiData.Name || 'Unknown',
                        description: apiData.Description || '',
                        price: apiData.PriceInRobux || 0,
                        isForSale: apiData.IsForSale || false
                    };

                    setCache(cacheKey, data);
                }

                results.push(data);

                // Delay untuk menghindari rate limit
                await new Promise(resolve => setTimeout(resolve, 100));

            } catch (error) {
                errors.push({
                    id: id,
                    error: error.message
                });
            }
        }

        res.json({
            success: true,
            data: results,
            errors: errors.length > 0 ? errors : undefined
        });

    } catch (error) {
        console.error('Error batch fetch:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        status: 'OK',
        uptime: process.uptime(),
        cacheSize: cache.size
    });
});

// GET / - Root endpoint
app.get('/', (req, res) => {
    res.json({
        name: 'Roblox Gamepass API',
        version: '1.0.0',
        endpoints: {
            'GET /api/gamepass/:id': 'Get single gamepass info',
            'POST /api/gamepass/batch': 'Get multiple gamepass info (max 20)',
            'GET /api/health': 'Health check'
        }
    });
});

// Clear cache setiap jam
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of cache.entries()) {
        if (now - value.timestamp > CACHE_DURATION) {
            cache.delete(key);
        }
    }
    console.log(`Cache cleaned. Current size: ${cache.size}`);
}, 60 * 60 * 1000);

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📍 http://localhost:${PORT}`);
});

// Handle shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down server...');
    process.exit(0);
});
