const puppeteer = require('puppeteer');
const fs = require('fs').promises;

class AliExpressScraper {
    constructor(options = {}) {
        this.browser = null;
        this.page = null;
        this.defaultOptions = {
            headless: true,
            searchTerm: '',
            minPrice: null,
            maxPrice: null,
            minOrderCount: null,
            shippingCountry: null,
            maxPages: 3,
            outputFile: 'aliexpress_products.json'
        };
        this.options = { ...this.defaultOptions, ...options };
    }

    async initialize() {
        this.browser = await puppeteer.launch({
            headless: this.options.headless,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu'
            ]
        });
        this.page = await this.browser.newPage();

        await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

        await this.page.setRequestInterception(true);
        this.page.on('request', (request) => {
            const resourceType = request.resourceType();
            const blockedResources = ['image', 'stylesheet', 'font'];

            if (blockedResources.includes(resourceType)) {
                request.abort();
            } else {
                request.continue();
            }
        });
    }

    async buildSearchURL() {
        let baseURL = 'https://www.aliexpress.com/wholesale';
        const params = new URLSearchParams();

        params.append('SearchText', encodeURIComponent(this.options.searchTerm));

        if (this.options.minPrice) {
            params.append('minPrice', this.options.minPrice);
        }
        if (this.options.maxPrice) {
            params.append('maxPrice', this.options.maxPrice);
        }

        return `${baseURL}?${params.toString()}`;
    }

    async scrapeProducts() {
        await this.initialize();
        const searchURL = await this.buildSearchURL();

        const products = [];

        try {
            await this.page.goto(searchURL, {
                waitUntil: 'networkidle0',
                timeout: 60000
            });

            await this.page.waitForSelector('.product-item', { timeout: 10000 });

            for (let pageNum = 1; pageNum <= this.options.maxPages; pageNum++) {
                const pageProducts = await this.page.evaluate((options) => {
                    const productElements = document.querySelectorAll('.product-item');
                    return Array.from(productElements).map(el => {
                        const titleEl = el.querySelector('.product-title');
                        const priceEl = el.querySelector('.price');
                        const orderCountEl = el.querySelector('.orders-count');
                        const ratingEl = el.querySelector('.rating');

                        return {
                            id: el.getAttribute('data-product-id') || 'N/A',
                            title: titleEl ? titleEl.innerText.trim() : 'N/A',
                            price: priceEl ? priceEl.innerText.trim() : 'N/A',
                            orderCount: orderCountEl ? orderCountEl.innerText.trim() : '0',
                            rating: ratingEl ? ratingEl.innerText.trim() : 'N/A',
                            link: el.querySelector('a') ? el.querySelector('a').href : 'N/A',
                            scraped_at: new Date().toISOString()
                        };
                    }).filter(product => {
                        const orderCount = parseInt(product.orderCount.replace(/\D/g, ''), 10) || 0;
                        return options.minOrderCount ? orderCount >= options.minOrderCount : true;
                    });
                }, this.options);

                products.push(...pageProducts);

                const nextPageButton = await this.page.$('.next-page');
                if (nextPageButton && pageNum < this.options.maxPages) {
                    await nextPageButton.click();
                    await this.page.waitForTimeout(2000);
                } else {
                    break;
                }
            }
        } catch (error) {
            console.error('Scraping error:', error);
        } finally {
            await this.browser.close();
        }

        return products;
    }

    async exportToJson(products) {
        const jsonOutput = {
            metadata: {
                search_term: this.options.searchTerm,
                min_price: this.options.minPrice,
                max_price: this.options.maxPrice,
                min_order_count: this.options.minOrderCount,
                total_products: products.length,
                scraped_at: new Date().toISOString()
            },
            products: products
        };

        try {
            await fs.writeFile(
                this.options.outputFile,
                JSON.stringify(jsonOutput, null, 2)
            );
            console.log(`JSON Export completed: ${this.options.outputFile}`);
        } catch (error) {
            console.error('JSON export error:', error);
        }

        return jsonOutput;
    }

    async run() {
        const products = await this.scrapeProducts();
        return await this.exportToJson(products);
    }
}

// Example usage
async function main() {
    const scraper = new AliExpressScraper({
        searchTerm: 'smartphone',
        minPrice: 100,
        maxPrice: 500,
        minOrderCount: 50,
        maxPages: 3,
        outputFile: 'aliexpress_smartphones.json'
    });

    try {
        const result = await scraper.run();
        console.log(`Scraped ${result.products.length} products`);
        console.log(JSON.stringify(result, null, 2));
    } catch (error) {
        console.error('Scraping failed:', error);
    }
}

main();

module.exports = AliExpressScraper;
