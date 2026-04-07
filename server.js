const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
    console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
    next();
});

function getRandomUserAgent() {
    const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
        'Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
        'Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
    ];
    return userAgents[Math.floor(Math.random() * userAgents.length)];
}

function isMercadoLivreUrl(url) {
    if (!url) return false;
    
    const urlLower = url.toLowerCase();
    const mercadoLivrePatterns = [
        /mercadolivre\./i,
        /mercadolivre\.com\.br/i,
        /mercadolivre\.com/i,
        /ml\.com/i,
        /lista\.mercadolivre/i,
        /produto\.mercadolivre/i,
        /item\.mercadolivre/i,
        /\/MLB[-_]?\d+/i,
        /\/p\/MLB/i,
        /\/sec\/[A-Z0-9]+/i,
        /\/jump-to\/[A-Z0-9]+/i,
        /\/redirect\/[A-Z0-9]+/i,
        /meli\.la\//i,              // ✅ Link encurtado do Mercado Livre
        /mercadolibre\./i
    ];
    
    return mercadoLivrePatterns.some(pattern => pattern.test(url));
}

function isAmazonUrl(url) {
    if (!url) return false;
    
    const urlLower = url.toLowerCase();
    const amazonPatterns = [
        /amazon\.com\.br/i,
        /amazon\.com/i,
        /amzn\.to/i,                 // ✅ Link encurtado da Amazon
        /a\.co/i,                    // ✅ Outro formato de link encurtado
        /\/dp\//i,
        /\/gp\//i,
        /\/product\//i,
        /\?asin=/i,
        /\/ASIN\//i
    ];
    
    return amazonPatterns.some(pattern => pattern.test(urlLower));
}

async function followRedirects(url, maxRedirects = 5) {
    console.log(`🔍 Seguindo redirecionamentos de: ${url}`);
    
    let currentUrl = url;
    let redirectCount = 0;
    let redirectChain = [url];
    
    try {
        while (redirectCount < maxRedirects) {
            console.log(`   📍 Tentativa ${redirectCount + 1}: ${currentUrl}`);
            
            const response = await axios.get(currentUrl, {
                maxRedirects: 0,
                timeout: 15000,
                validateStatus: function (status) {
                    return status >= 200 && status < 400;
                },
                headers: {
                    'User-Agent': getRandomUserAgent(),
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8,es;q=0.7'
                }
            });
            
            if (response.status >= 300 && response.status < 400 && response.headers.location) {
                let redirectUrl = response.headers.location;
                
                if (!redirectUrl.startsWith('http')) {
                    const baseUrl = new URL(currentUrl);
                    redirectUrl = new URL(redirectUrl, baseUrl).toString();
                }
                
                console.log(`   ↪️ Redirecionando para: ${redirectUrl}`);
                
                if (redirectChain.includes(redirectUrl)) {
                    console.log('   ⚠️ Loop de redirecionamento detectado, parando...');
                    break;
                }
                
                currentUrl = redirectUrl;
                redirectChain.push(redirectUrl);
                redirectCount++;
                continue;
            }
            
            break;
        }
        
        console.log(`🏁 URL final após ${redirectCount} redirecionamentos: ${currentUrl}`);
        return {
            finalUrl: currentUrl,
            redirectCount: redirectCount,
            redirectChain: redirectChain
        };
        
    } catch (error) {
        console.error('❌ Erro ao seguir redirecionamentos:', error.message);
        return {
            finalUrl: url,
            redirectCount: 0,
            redirectChain: [url],
            error: error.message
        };
    }
}

function normalizeMercadoLivreUrl(url) {
    console.log(`🔗 URL Mercado Livre original: ${url}`);
    
    try {
        if (!url.startsWith('http')) {
            url = 'https://' + url;
        }
        
        const urlObj = new URL(url);
        
        // ✅ Detecta se é link encurtado do meli.la
        const isShortened = url.includes('meli.la/');
        
        const paramsToRemove = [
            'matt_tool', 'me', 'afiliado', 'utm_source', 'utm_medium', 
            'utm_campaign', 'ref', 'source', 'afilio', 'partner', 'tracking',
            'matt', 'tool', 'campaign', 'medium', 'source', 'matt_source',
            'utm_content', 'utm_term', 'gclid', 'fbclid'
        ];
        
        const searchParams = new URLSearchParams(urlObj.search);
        let hadAffiliateParams = false;
        
        paramsToRemove.forEach(param => {
            const paramLower = param.toLowerCase();
            const keysToRemove = [];
            
            searchParams.forEach((value, key) => {
                if (key.toLowerCase().includes(paramLower)) {
                    keysToRemove.push(key);
                    hadAffiliateParams = true;
                }
            });
            
            keysToRemove.forEach(key => {
                searchParams.delete(key);
            });
        });
        
        urlObj.search = searchParams.toString();
        let cleanUrl = urlObj.toString();
        
        let productId = null;
        
        if (cleanUrl.includes('MLB') || cleanUrl.includes('/p/')) {
            const patterns = [
                /(MLB[-_]?\d{9,})/i,
                /\/p\/(MLB\d{9,})/i,
                /\/produto\/(MLB[-_]?\d{9,})/i,
                /\/item\/(MLB[-_]?\d{9,})/i,
                /\/mlb\/(\d{9,})/i,
                /[?&]id=(MLB\d{9,})/i,
                /[?&]id=(\d{9,})/i,
                /[?&]MLB=(\d{9,})/i,
                /\/dp\/(MLB[-_]?\d{9,})/i,
                /\/(MLB[-_]?\d{9,})-/i,
                /-(\d{9,})-/
            ];
            
            for (const pattern of patterns) {
                const match = cleanUrl.match(pattern);
                if (match) {
                    productId = match[1] || match[0];
                    productId = productId.toUpperCase();
                    if (productId.includes('MLB')) {
                        productId = productId.replace('MLB-', 'MLB').replace('MLB_', 'MLB');
                    } else if (/^\d{9,}$/.test(productId)) {
                        productId = 'MLB-' + productId;
                    }
                    break;
                }
            }
        }
        
        let scrapingUrl = cleanUrl;
        
        // ✅ Para links encurtados, mantemos a URL original para seguir redirecionamentos
        if (isShortened) {
            scrapingUrl = url; // Usa a URL encurtada original para seguir o redirect
            console.log(`🔄 Link encurtado detectado, usando para redirecionamento: ${scrapingUrl}`);
        }
        
        console.log(`🔄 URL para scraping: ${scrapingUrl}`);
        console.log(`🆔 ID detectado: ${productId || 'Não encontrado'}`);
        
        return {
            success: true,
            originalUrl: url,
            scrapingUrl: scrapingUrl,
            normalizedUrl: productId ? `https://produto.mercadolivre.com.br/${productId}` : scrapingUrl,
            productId: productId,
            isAffiliateLink: hadAffiliateParams || url.includes('/sec/') || url.includes('/jump-to/') || url.includes('/redirect/') || isShortened,
            isShortened: isShortened
        };
        
    } catch (error) {
        console.error('❌ Erro ao normalizar URL:', error.message);
        return {
            success: false,
            error: 'URL inválida: ' + error.message,
            originalUrl: url
        };
    }
}

function normalizeAmazonUrl(url) {
    console.log(`🔗 URL Amazon original: ${url}`);
    
    try {
        if (!url.startsWith('http')) {
            url = 'https://' + url;
        }
        
        const urlObj = new URL(url);
        
        // ✅ Detecta se é link encurtado (amzn.to ou a.co)
        const isShortened = url.includes('amzn.to/') || url.includes('a.co/');
        
        let cleanUrl = url;
        
        console.log(`🔄 URL mantida para processamento: ${cleanUrl}`);
        console.log(`🔄 Link encurtado: ${isShortened ? 'Sim' : 'Não'}`);
        
        return {
            success: true,
            originalUrl: url,
            scrapingUrl: cleanUrl,
            normalizedUrl: cleanUrl,
            asin: null,
            isAffiliateLink: isShortened,
            isShortened: isShortened
        };
        
    } catch (error) {
        console.error('❌ Erro ao normalizar URL Amazon:', error.message);
        return {
            success: false,
            error: 'URL inválida: ' + error.message,
            originalUrl: url
        };
    }
}

async function scrapeMercadoLivre(url) {
    console.log(`🔍 Iniciando scraping Mercado Livre: ${url}`);
    
    try {
        const headers = {
            'User-Agent': getRandomUserAgent(),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8,es;q=0.7',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Referer': 'https://www.mercadolivre.com.br/'
        };
        
        const response = await axios.get(url, { 
            headers, 
            timeout: 15000,
            maxRedirects: 5
        });
        
        const $ = cheerio.load(response.data);
        
        let title = '';
        
        const mainTitle = $('h1.ui-pdp-title').text().trim();
        if (mainTitle) {
            title = mainTitle;
            console.log('✅ Título encontrado via h1.ui-pdp-title');
        }
        
        if (!title) {
            const ogTitle = $('meta[property="og:title"]').attr('content');
            if (ogTitle) {
                title = ogTitle;
                console.log('✅ Título encontrado via meta og:title');
            }
        }
        
        if (!title) {
            const pageTitle = $('title').text().trim();
            if (pageTitle) {
                title = pageTitle;
                console.log('✅ Título encontrado via title tag');
            }
        }
        
        if (!title) {
            const altTitle = $('h1.ui-pdp-header__title').text().trim() ||
                            $('.ui-pdp-header__title-container').text().trim() ||
                            $('.item-title').text().trim();
            if (altTitle) {
                title = altTitle;
                console.log('✅ Título encontrado via seletores alternativos');
            }
        }
        
        if (title) {
            title = title.replace(/\|\s*Mercado Livre/i, '')
                        .replace(/-\s*Mercado Livre/i, '')
                        .replace(/\s*-\s*$/, '')
                        .trim();
            
            title = title.replace(/\s+/g, ' ').trim();
            
            console.log(`📝 Título final: ${title.substring(0, 100)}...`);
        } else {
            title = 'Produto Mercado Livre';
            console.log('⚠️ Título não encontrado, usando padrão');
        }
        
        let price = 0;
        let formattedPrice = 'Preço não disponível';
        let priceFound = false;
        
        const priceMeta = $('meta[property="product:price:amount"]').attr('content');
        if (priceMeta) {
            price = parseFloat(priceMeta);
            priceFound = !isNaN(price);
            console.log('💰 Preço encontrado via meta product:price:amount');
        }
        
        if (!priceFound) {
            const priceText = $('span.andes-money-amount__fraction').first().text().trim() ||
                             $('div.ui-pdp-price__second-line').find('span.andes-money-amount__fraction').text().trim() ||
                             $('span.ui-pdp-price__part').find('.andes-money-amount__fraction').text().trim() ||
                             $('.price-tag-fraction').text().trim();
            
            if (priceText) {
                const cleanPrice = priceText.replace(/\./g, '').replace(',', '.');
                price = parseFloat(cleanPrice);
                priceFound = !isNaN(price);
                console.log('💰 Preço encontrado via elementos de preço');
            }
        }
        
        if (!priceFound) {
            const scriptTags = $('script[type="application/ld+json"]');
            scriptTags.each((i, el) => {
                try {
                    const json = JSON.parse($(el).html());
                    if (json.offers && json.offers.price) {
                        price = parseFloat(json.offers.price);
                        priceFound = !isNaN(price);
                        if (priceFound) {
                            console.log('💰 Preço encontrado via JSON-LD');
                            return false;
                        }
                    }
                } catch (e) {
                }
            });
        }
        
        if (priceFound) {
            formattedPrice = `R$ ${price.toFixed(2).replace('.', ',')}`;
            console.log(`💰 Preço final: ${formattedPrice}`);
        }
        
        let imageUrl = '';
        
        imageUrl = $('meta[property="og:image"]').attr('content') ||
                   $('meta[name="twitter:image"]').attr('content') ||
                   $('figure.ui-pdp-gallery__figure img').attr('src') ||
                   $('img.ui-pdp-image').attr('src');
        
        if (imageUrl) {
            if (imageUrl.startsWith('//')) {
                imageUrl = 'https:' + imageUrl;
            } else if (imageUrl.startsWith('/')) {
                imageUrl = 'https://http2.mlstatic.com' + imageUrl;
            }
            console.log('🖼️ Imagem encontrada');
        }
        
        let seller = $('.ui-pdp-seller__header__title').text().trim() || 
                     $('.ui-pdp-seller__link-trigger').text().trim() ||
                     $('.ui-pdp-seller__header__info').text().trim();
        
        let condition = $('.ui-pdp-subtitle').text().trim() ||
                        $('.ui-pdp-header__subtitle').text().trim() ||
                        'Não informado';
        
        let productId = null;
        const idMatch = response.data.match(/MLB[-_]?\d{9,}/i) ||
                       url.match(/MLB[-_]?\d{9,}/i);
        
        if (idMatch) {
            productId = idMatch[0].toUpperCase().replace('MLB-', 'MLB').replace('MLB_', 'MLB');
        }
        
        console.log(`✅ Scraping concluído: ${title.substring(0, 60)}...`);
        
        return {
            success: true,
            data: {
                id: productId,
                title: title,
                price: price,
                currency_id: 'BRL',
                formatted_price: formattedPrice,
                pictures: imageUrl ? [{ url: imageUrl }] : [],
                thumbnail: imageUrl || '',
                seller: seller ? { nickname: seller } : null,
                condition: condition,
                permalink: url,
                is_affiliate_link: false,
                date_created: new Date().toISOString(),
                _metadata: {
                    extracted_at: new Date().toISOString(),
                    method: 'mercado_livre_scraping',
                    has_image: !!imageUrl,
                    has_price: priceFound,
                    status_code: response.status,
                    title_extraction_method: 'multiple_strategies'
                }
            }
        };
        
    } catch (error) {
        console.error('❌ Erro no scraping Mercado Livre:', error.message);
        
        return {
            success: false,
            error: error.message,
            suggestion: 'Não foi possível extrair os dados deste link do Mercado Livre.'
        };
    }
}

async function scrapeAmazon(url) {
    console.log(`🔍 Iniciando scraping Amazon: ${url}`);
    
    try {
        const headers = {
            'User-Agent': getRandomUserAgent(),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7,es;q=0.6',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Cache-Control': 'max-age=0',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1'
        };
        
        const response = await axios.get(url, { 
            headers, 
            timeout: 20000,
            maxRedirects: 5
        });
        
        const $ = cheerio.load(response.data);
        
        let title = '';
        
        const mainTitle = $('#productTitle').text().trim();
        if (mainTitle) {
            title = mainTitle;
            console.log('✅ Título Amazon encontrado via #productTitle');
        }
        
        if (!title) {
            const altTitle = $('#title').text().trim() ||
                            $('h1.a-size-large').text().trim() ||
                            $('h1.a-size-medium').text().trim();
            if (altTitle) {
                title = altTitle;
                console.log('✅ Título Amazon encontrado via seletores alternativos');
            }
        }
        
        if (!title) {
            const ogTitle = $('meta[property="og:title"]').attr('content');
            if (ogTitle) {
                title = ogTitle;
                console.log('✅ Título Amazon encontrado via meta og:title');
            }
        }
        
        if (!title) {
            const pageTitle = $('title').text().trim();
            if (pageTitle) {
                title = pageTitle;
                console.log('✅ Título Amazon encontrado via title tag');
            }
        }
        
        if (title) {
            title = title.replace(/\|\s*Amazon\.com\.br/i, '')
                        .replace(/-\s*Amazon\.com\.br/i, '')
                        .replace(/\|\s*Amazon/i, '')
                        .replace(/-\s*Amazon/i, '')
                        .replace(/:\s*Amazon\.com\.br/i, '')
                        .replace(/\s*-\s*$/, '')
                        .trim();
            
            title = title.replace(/\s+/g, ' ').trim();
            
            console.log(`📝 Título Amazon final: ${title.substring(0, 100)}...`);
        } else {
            title = 'Produto Amazon';
            console.log('⚠️ Título Amazon não encontrado, usando padrão');
        }
        
        let price = 0;
        let formattedPrice = 'Preço não disponível';
        let priceFound = false;
        
        const priceWhole = $('.a-price-whole').first().text().trim();
        const priceFraction = $('.a-price-fraction').first().text().trim();
        
        if (priceWhole) {
            let priceStr = priceWhole.replace(/\./g, '').replace(',', '.');
            if (priceFraction) {
                priceStr += priceFraction;
            }
            price = parseFloat(priceStr);
            priceFound = !isNaN(price);
            console.log('💰 Preço Amazon encontrado via .a-price-whole');
        }
        
        if (!priceFound) {
            const priceText = $('#priceblock_ourprice').text().trim() ||
                             $('#priceblock_dealprice').text().trim() ||
                             $('#priceblock_saleprice').text().trim() ||
                             $('.a-color-price').first().text().trim();
            
            if (priceText) {
                const cleanPrice = priceText.replace(/R\$\s*/, '')
                                          .replace(/\./g, '')
                                          .replace(',', '.')
                                          .replace(/[^\d.]/g, '');
                price = parseFloat(cleanPrice);
                priceFound = !isNaN(price);
                if (priceFound) {
                    console.log('💰 Preço Amazon encontrado via seletores alternativos');
                }
            }
        }
        
        if (!priceFound) {
            const scriptTags = $('script[type="application/ld+json"]');
            scriptTags.each((i, el) => {
                try {
                    const json = JSON.parse($(el).html());
                    if (json.offers && json.offers.price) {
                        price = parseFloat(json.offers.price);
                        priceFound = !isNaN(price);
                        if (priceFound) {
                            console.log('💰 Preço Amazon encontrado via JSON-LD');
                            return false;
                        }
                    }
                    if (json.price) {
                        price = parseFloat(json.price);
                        priceFound = !isNaN(price);
                        if (priceFound) {
                            console.log('💰 Preço Amazon encontrado via JSON-LD price');
                            return false;
                        }
                    }
                } catch (e) {
                }
            });
        }
        
        if (priceFound) {
            formattedPrice = `R$ ${price.toFixed(2).replace('.', ',')}`;
            console.log(`💰 Preço Amazon final: ${formattedPrice}`);
        }
        
        let imageUrl = '';
        let bestQualityImage = '';
        
        const imgSelectors = [
            '#landingImage', 
            '#imgBlkFront',
            'img[data-old-hires]',
            'img[data-a-dynamic-image]',
            'img[data-a-image-name="landingImage"]',
            '.a-dynamic-image'
        ];
        
        $('img').each((i, element) => {
            const imgSrc = $(element).attr('src') || $(element).attr('data-src') || $(element).attr('data-old-hires');
            
            if (imgSrc) {
                if (imgSrc.includes('images-na.ssl-images-amazon.com') || 
                    imgSrc.includes('m.media-amazon.com') ||
                    imgSrc.includes('amazon.com/images/I/')) {
                    
                    if (imgSrc.includes('._AC_SX') || imgSrc.includes('._SL') || imgSrc.includes('.jpg')) {
                        
                        const hasHighResKeywords = imgSrc.includes('CR,') || 
                                                  imgSrc.includes('_AC_SX679') || 
                                                  imgSrc.includes('_AC_SY879') ||
                                                  imgSrc.includes('_AC_SL1500') ||
                                                  imgSrc.includes('_AC_SX466') ||
                                                  imgSrc.includes('_AC_SX569');
                        
                        let highQualityUrl = imgSrc;
                        
                        if (imgSrc.includes('._AC_')) {
                            highQualityUrl = imgSrc.replace(/\._AC_SX\d+_\./, '.')
                                                 .replace(/\._AC_SY\d+_\./, '.')
                                                 .replace(/\._AC_SL\d+_\./, '.')
                                                 .replace(/\._AC_UL\d+_\./, '.')
                                                 .replace(/\._AC_SR\d+,\d+_\./, '.');
                            
                            if (highQualityUrl !== imgSrc) {
                                bestQualityImage = highQualityUrl;
                                console.log(`🖼️ Imagem de alta qualidade encontrada via remoção de parâmetros AC`);
                            }
                        }
                        
                        if (!imageUrl || hasHighResKeywords) {
                            imageUrl = imgSrc;
                        }
                    }
                }
            }
        });
        
        if (!bestQualityImage) {
            const ogImage = $('meta[property="og:image"]').attr('content');
            if (ogImage) {
                bestQualityImage = ogImage;
                console.log('🖼️ Imagem encontrada via meta og:image');
            }
        }
        
        if (!bestQualityImage) {
            const scriptTags = $('script[type="application/ld+json"]');
            scriptTags.each((i, el) => {
                try {
                    const json = JSON.parse($(el).html());
                    if (json.image) {
                        if (Array.isArray(json.image) && json.image.length > 0) {
                            bestQualityImage = json.image[0];
                            console.log('🖼️ Imagem encontrada via JSON-LD array');
                            return false;
                        } else if (typeof json.image === 'string') {
                            bestQualityImage = json.image;
                            console.log('🖼️ Imagem encontrada via JSON-LD string');
                            return false;
                        }
                    }
                } catch (e) {
                }
            });
        }
        
        if (!bestQualityImage && imageUrl) {
            bestQualityImage = imageUrl;
            console.log('🖼️ Usando primeira imagem encontrada');
        }
        
        if (!bestQualityImage) {
            const scriptText = response.data;
            const imagePatterns = [
                /"hiRes":"([^"]+)"/,
                /"large":"([^"]+)"/,
                /"mainUrl":"([^"]+)"/,
                /"primaryImageUrl":"([^"]+)"/,
                /images-na\.ssl-images-amazon\.com\/images\/I\/[^"]+\.(jpg|png|webp)/i,
                /m\.media-amazon\.com\/images\/I\/[^"]+\.(jpg|png|webp)/i
            ];
            
            for (const pattern of imagePatterns) {
                const match = scriptText.match(pattern);
                if (match && match[1]) {
                    bestQualityImage = match[1];
                    console.log(`🖼️ Imagem encontrada via pattern: ${pattern.toString().substring(0, 50)}...`);
                    break;
                }
            }
        }
        
        if (bestQualityImage) {
            if (bestQualityImage.startsWith('//')) {
                bestQualityImage = 'https:' + bestQualityImage;
            }
            
            if (bestQualityImage.includes('._AC_')) {
                bestQualityImage = bestQualityImage.replace(/\._AC_SX\d+_\./, '._AC_SX679_.')
                                                 .replace(/\._AC_SY\d+_\./, '._AC_SY879_.')
                                                 .replace(/\._AC_SL\d+_\./, '._AC_SL1500_.');
            }
            
            console.log(`🖼️ Imagem final em alta qualidade: ${bestQualityImage.substring(0, 100)}...`);
        } else if (imageUrl) {
            bestQualityImage = imageUrl;
            console.log('🖼️ Usando imagem padrão encontrada');
        }
        
        let asin = null;
        
        const urlAsinMatch = url.match(/\/([A-Z0-9]{10})(?:\/|$|\?)/i);
        if (urlAsinMatch) {
            asin = urlAsinMatch[1].toUpperCase();
        }
        
        if (!asin) {
            const htmlAsinMatch = response.data.match(/"asin":"([A-Z0-9]{10})"/i);
            if (htmlAsinMatch) {
                asin = htmlAsinMatch[1].toUpperCase();
            }
        }
        
        if (!asin) {
            const asinElement = $('#ASIN').val() || $('input[name="ASIN"]').val();
            if (asinElement) {
                asin = asinElement.toUpperCase();
            }
        }
        
        if (!asin) {
            const bodyAsinMatch = response.data.match(/ASIN["']?\s*[:=]\s*["']([A-Z0-9]{10})["']/i);
            if (bodyAsinMatch) {
                asin = bodyAsinMatch[1].toUpperCase();
            }
        }
        
        console.log(`🆔 ASIN detectado: ${asin || 'Não encontrado'}`);
        
        console.log(`✅ Scraping Amazon concluído: ${title.substring(0, 60)}...`);
        
        return {
            success: true,
            data: {
                id: asin,
                title: title,
                price: price,
                currency_id: 'BRL',
                formatted_price: formattedPrice,
                pictures: bestQualityImage ? [{ url: bestQualityImage }] : [],
                thumbnail: bestQualityImage || '',
                seller: { nickname: 'Amazon' },
                condition: 'Novo',
                permalink: url,
                is_affiliate_link: false,
                date_created: new Date().toISOString(),
                _metadata: {
                    extracted_at: new Date().toISOString(),
                    method: 'amazon_scraping_high_quality',
                    has_image: !!bestQualityImage,
                    has_price: priceFound,
                    status_code: response.status,
                    title_extraction_method: 'multiple_strategies',
                    platform: 'amazon',
                    asin: asin,
                    image_quality: bestQualityImage ? 'high' : 'standard'
                }
            }
        };
        
    } catch (error) {
        console.error('❌ Erro no scraping Amazon:', error.message);
        
        return {
            success: false,
            error: error.message,
            suggestion: 'Não foi possível extrair os dados deste link da Amazon.'
        };
    }
}

app.post('/api/extract', async (req, res) => {
    try {
        const { url } = req.body;
        
        if (!url) {
            return res.status(400).json({
                error: true,
                message: 'URL do produto é obrigatória',
                suggestion: 'Cole o link do produto do Mercado Livre'
            });
        }
        
        console.log(`\n📨 Recebido Mercado Livre: ${url}`);
        
        if (!isMercadoLivreUrl(url)) {
            return res.status(400).json({
                error: true,
                message: 'Isso não parece ser um link do Mercado Livre',
                suggestion: 'Use um link que comece com mercadolivre.com.br ou meli.la',
                example: 'https://produto.mercadolivre.com.br/MLB-1234567890 ou https://meli.la/1r1BBFY'
            });
        }
        
        const normalized = normalizeMercadoLivreUrl(url);
        
        if (!normalized.success) {
            return res.status(400).json({
                error: true,
                message: 'URL inválida',
                suggestion: 'Verifique o link e tente novamente',
                original_url: url
            });
        }
        
        let finalUrl = normalized.scrapingUrl;
        
        // ✅ Segue redirecionamentos se for link encurtado ou de afiliado
        if (normalized.isAffiliateLink || normalized.isShortened || normalized.scrapingUrl.includes('/sec/')) {
            console.log('🔍 Link encurtado/afiliado detectado, seguindo redirecionamentos...');
            const redirectResult = await followRedirects(normalized.scrapingUrl);
            finalUrl = redirectResult.finalUrl;
            console.log(`🏁 URL final após redirecionamentos: ${finalUrl}`);
        }
        
        const result = await scrapeMercadoLivre(finalUrl);
        
        if (result.success) {
            const responseData = {
                ...result.data,
                _metadata: {
                    ...result.data._metadata,
                    original_url: normalized.originalUrl,
                    normalized_url: normalized.normalizedUrl,
                    scraping_url: finalUrl,
                    product_id: normalized.productId,
                    was_normalized: normalized.isAffiliateLink || normalized.isShortened,
                    was_shortened: normalized.isShortened,
                    extraction_method: 'mercado_livre'
                }
            };
            
            res.json(responseData);
        } else {
            res.status(500).json({
                error: true,
                message: result.error || 'Erro ao extrair dados',
                suggestion: result.suggestion || 'Tente novamente ou use um link diferente',
                debug: {
                    original: normalized.originalUrl,
                    scraping_url: finalUrl,
                    is_affiliate: normalized.isAffiliateLink,
                    is_shortened: normalized.isShortened
                }
            });
        }
        
    } catch (error) {
        console.error('❌ Erro na API Mercado Livre:', error);
        res.status(500).json({
            error: true,
            message: 'Erro interno do servidor',
            details: error.message,
            suggestion: 'Tente novamente em alguns instantes'
        });
    }
});

app.post('/api/extract-amazon', async (req, res) => {
    try {
        const { url } = req.body;
        
        if (!url) {
            return res.status(400).json({
                error: true,
                message: 'URL do produto é obrigatória',
                suggestion: 'Cole o link do produto da Amazon'
            });
        }
        
        console.log(`\n📨 Recebido Amazon: ${url}`);
        
        if (!isAmazonUrl(url)) {
            return res.status(400).json({
                error: true,
                message: 'Isso não parece ser um link da Amazon',
                suggestion: 'Use um link que comece com amazon.com.br, amzn.to ou a.co',
                example: 'https://www.amazon.com.br/dp/B08N5WRWNW ou https://amzn.to/4qjSzCV'
            });
        }
        
        const normalized = normalizeAmazonUrl(url);
        
        if (!normalized.success) {
            return res.status(400).json({
                error: true,
                message: 'URL inválida',
                suggestion: 'Verifique o link e tente novamente',
                original_url: url
            });
        }
        
        console.log('🔍 Seguindo redirecionamentos para link Amazon...');
        const redirectResult = await followRedirects(normalized.scrapingUrl, 3);
        const finalUrl = redirectResult.finalUrl;
        
        console.log(`🏁 URL final após redirecionamentos: ${finalUrl}`);
        
        const result = await scrapeAmazon(finalUrl);
        
        if (result.success) {
            const responseData = {
                ...result.data,
                _metadata: {
                    ...result.data._metadata,
                    original_url: normalized.originalUrl,
                    normalized_url: normalized.normalizedUrl,
                    scraping_url: finalUrl,
                    redirect_count: redirectResult.redirectCount,
                    redirect_chain: redirectResult.redirectChain,
                    was_shortened: normalized.isShortened,
                    extraction_method: 'amazon'
                }
            };
            
            res.json(responseData);
        } else {
            res.status(500).json({
                error: true,
                message: result.error || 'Erro ao extrair dados',
                suggestion: result.suggestion || 'Tente novamente ou use um link diferente',
                debug: {
                    original: normalized.originalUrl,
                    scraping_url: finalUrl,
                    is_shortened: normalized.isShortened,
                    redirect_chain: redirectResult.redirectChain
                }
            });
        }
        
    } catch (error) {
        console.error('❌ Erro na API Amazon:', error);
        res.status(500).json({
            error: true,
            message: 'Erro interno do servidor',
            details: error.message,
            suggestion: 'Tente novamente em alguns instantes'
        });
    }
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'online',
        service: 'Product Scraper API',
        version: '3.2.0',
        timestamp: new Date().toISOString(),
        features: [
            'mercado_livre_scraping', 
            'amazon_scraping_high_quality', 
            'redirect_following',
            'shortened_urls_support',
            'high_quality_images'
        ],
        endpoints: {
            'POST /api/extract': 'Extrair dados do Mercado Livre (suporta links encurtados meli.la)',
            'POST /api/extract-amazon': 'Extrair dados da Amazon com imagens de alta qualidade (suporta amzn.to, a.co)'
        }
    });
});

app.get('/', (req, res) => {
    res.json({
        name: 'Product Scraper API',
        version: '3.2.0',
        description: 'API para extrair dados de produtos do Mercado Livre e Amazon (com imagens em alta qualidade)',
        endpoints: {
            'POST /api/extract': 'Extrair dados do Mercado Livre - Suporta meli.la',
            'POST /api/extract-amazon': 'Extrair dados da Amazon - Suporta amzn.to, a.co',
            'GET /api/health': 'Status do serviço'
        },
        features: [
            'Extrai título, preço e imagem de produtos',
            'Suporte a Mercado Livre e Amazon',
            '✅ Suporte a links encurtados: meli.la, amzn.to, a.co',
            'Imagens em alta qualidade para Amazon',
            'Suporte a links de afiliado',
            'Limpeza automática de parâmetros de afiliado',
            'Seguimento de redirecionamentos',
            'Multiplas estratégias de fallback'
        ],
        examples: {
            mercado_livre_direto: 'https://produto.mercadolivre.com.br/MLB-1234567890',
            mercado_livre_encurtado: 'https://meli.la/1r1BBFY',  // ✅ Funciona!
            amazon_direto: 'https://www.amazon.com.br/dp/B08N5WRWNW',
            amazon_encurtado: 'https://amzn.to/4qjSzCV'          // ✅ Funciona!
        }
    });
});

app.listen(PORT, () => {
    console.log('\n' + '='.repeat(70));
    console.log('🚀 PRODUCT SCRAPER API v3.2.0 - MERCADO LIVRE & AMAZON (ALTA QUALIDADE)');
    console.log('='.repeat(70));
    console.log(`✅ Servidor: http://localhost:${PORT}`);
    console.log(`📡 Health: http://localhost:${PORT}/api/health`);
    console.log('');
    console.log('🌟 SUPORTE A LINKS ENCURTADOS:');
    console.log('   • Mercado Livre: meli.la/XXXXX ✅');
    console.log('   • Amazon: amzn.to/XXXXX ✅');
    console.log('   • Amazon: a.co/XXXXX ✅');
    console.log('');
    console.log('📋 ENDPOINTS:');
    console.log('   POST /api/extract          - Extrair dados do Mercado Livre');
    console.log('   POST /api/extract-amazon   - Extrair dados da Amazon (alta qualidade)');
    console.log('');
    console.log('💡 EXEMPLOS:');
    console.log('   • https://produto.mercadolivre.com.br/MLB-1234567890');
    console.log('   • https://meli.la/1r1BBFY (✅ link encurtado)');
    console.log('   • https://www.amazon.com.br/dp/B08N5WRWNW');
    console.log('   • https://amzn.to/4qjSzCV (✅ link encurtado)');
    console.log('='.repeat(70));
});
