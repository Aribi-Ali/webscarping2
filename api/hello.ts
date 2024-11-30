import type { VercelRequest, VercelResponse } from '@vercel/node'
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Validate request method
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // Extract scraping options from request body
    const { 
        searchTerm = 'smartphone', 
        minPrice = 100, 
        maxPrice = 500, 
        minOrderCount = 50, 
        maxPages = 3 
    } = req.body;

    try {
        const browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
        });

        const page = await browser.newPage();

        // Build search URL
        const baseURL = 'https://www.aliexpress.com/wholesale';
        const params = new URLSearchParams();
        params.append('SearchText', encodeURIComponent(searchTerm));
        
        if (minPrice) params.append('minPrice', minPrice.toString());
        if (maxPrice) params.append('maxPrice', maxPrice.toString());

        const searchURL = `${baseURL}?${params.toString()}`;

        // Navigate to search page
        await page.goto(searchURL, { 
            waitUntil: 'networkidle0',
            timeout: 60000 
        });

        // Scrape products
        const products = await page.evaluate((options) => {
            const productElements = document.querySelectorAll('.product-item');
            return Array.from(productElements).map(el => {
                const titleEl = el.querySelector('.product-title');
                const priceEl = el.querySelector('.price');
                const orderCountEl = el.querySelector('.orders-count');
                const ratingEl = el.querySelector('.rating');

                const orderCount = orderCountEl ? 
                    parseInt(orderCountEl.innerText.replace(/\D/g, ''), 10) || 0 
                    : 0;

                // Apply order count filter
                if (options.minOrderCount && orderCount < options.minOrderCount) {
                    return null;
                }

                return {
                    id: el.getAttribute('data-product-id') || 'N/A',
                    title: titleEl ? titleEl.innerText.trim() : 'N/A',
                    price: priceEl ? priceEl.innerText.trim() : 'N/A',
                    orderCount: orderCountEl ? orderCountEl.innerText.trim() : '0',
                    rating: ratingEl ? ratingEl.innerText.trim() : 'N/A',
                    link: el.querySelector('a') ? el.querySelector('a').href : 'N/A',
                    scraped_at: new Date().toISOString()
                };
            }).filter(product => product !== null);
        }, { minOrderCount });

        // Close browser
        await browser.close();

        // Prepare response
        const result = {
            metadata: {
                search_term: searchTerm,
                min_price: minPrice,
                max_price: maxPrice,
                min_order_count: minOrderCount,
                total_products: products.length,
                scraped_at: new Date().toISOString()
            },
            products: products
        };

        // Send response
        return res.status(200).json(result);
    } catch (error) {
        console.error('Scraping error:', error);
        return res.status(500).json({ 
            error: 'Scraping failed', 
            details: error instanceof Error ? error.message : 'Unknown error' 
        });
    }
}
