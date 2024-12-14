// fetchNews.js
import axios from 'axios';
import { load } from 'cheerio';
import fs from 'fs/promises';
import { URL } from 'url';

/**
 * Мапінг українських місяців до числового представлення
 */
const MONTH_MAP = {
    'січ.': 0,    // January
    'лют.': 1,    // February
    'берез.': 2,  // March
    'квіт.': 3,   // April
    'трав.': 4,   // May
    'черв.': 5,   // June
    'лип.': 6,    // July
    'серп.': 7,   // August
    'вер.': 8,    // September
    'жовт.': 9,   // October
    'лист.': 10,  // November
    'груд.': 11    // December
};

// Базовий URL сайту НБУ
const BASE_URL = 'https://bank.gov.ua';

// URL розділу новин
const NEWS_SECTION = 'https://bank.gov.ua/#4-novyny';

// Категорії новин з відповідними ID
const categories = [
    { id: 'tabs-news-feed-4-0', name: 'Усі' },
    { id: 'tabs-news-feed-4-1', name: 'Новини' },
    { id: 'tabs-news-feed-4-2', name: 'Повідомлення' },
    { id: 'tabs-news-feed-4-3', name: 'Пряма Мова' },
];

/**
 * Функція для збору новин з сайту НБУ
 * @returns {Array} - Масив об'єктів новин
 */
async function fetchNews() {
    let html;
    try {
        // Використовуємо Axios для отримання HTML сторінки новин
        const response = await axios.get(NEWS_SECTION, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            }
        });
        html = response.data;
    } catch (error) {
        console.error('Помилка при завантаженні сторінки новин:', error);
        return [];
    }

    const $ = load(html);
    let newsItems = [];

    // Отримуємо дату попереднього дня
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1); // Віднімаємо один день

    const yesterdayDay = yesterday.getDate();
    const yesterdayMonth = yesterday.getMonth();
    const yesterdayYear = yesterday.getFullYear();

    // Проходимо по кожній категорії
    for (const category of categories) {
        const categoryId = category.id;
        const categoryName = category.name;

        // Вибираємо контейнер новин за ID категорії
        const categoryContainer = $(`#${categoryId}`);

        if (!categoryContainer.length) {
            console.warn(`Контейнер з ID "${categoryId}" не знайдено.`);
            continue;
        }

        // Парсинг новин в межах категорії
        categoryContainer.find('.collection-item.post-inline').each((index, element) => {
            const contentDiv = $(element).find('.content');
            const titleTag = contentDiv.find('p > a');
            const title = titleTag.text().trim();
            let link = titleTag.attr('href');
            const dateStr = contentDiv.find('.mark time').text().trim();

            // Перевірка наявності заголовка та посилання
            if (title && link) {
                // Переконайтеся, що посилання повне
                if (link && !link.startsWith('http')) {
                    link = new URL(link, BASE_URL).href;
                }

                // Парсинг дати
                const dateParts = dateStr.split(' ');
                if (dateParts.length >= 3) {
                    const day = parseInt(dateParts[0], 10);
                    const monthAbbr = dateParts[1];
                    const year = parseInt(dateParts[2], 10);

                    const month = MONTH_MAP[monthAbbr];
                    if (isNaN(day) || isNaN(month) || isNaN(year)) {
                        console.warn(`Невірний формат дати: ${dateStr}`);
                        return;
                    }

                    // Створення об'єкта дати
                    const newsDate = new Date(year, month, day);

                    // Фільтрація новин за попередньою датою
                    if (
                        newsDate.getDate() === yesterdayDay &&
                        newsDate.getMonth() === yesterdayMonth &&
                        newsDate.getFullYear() === yesterdayYear
                    ) {
                        newsItems.push({ title, link, date: dateStr, category: categoryName });
                    }
                } else {
                    console.warn(`Невірний формат дати: ${dateStr}`);
                }
            }
        });
    }

    // Видалення дублікатів за посиланням та категорією
    const uniqueNewsMap = new Map();
    newsItems.forEach(news => {
        const key = `${news.link}-${news.category}`;
        if (!uniqueNewsMap.has(key)) {
            uniqueNewsMap.set(key, news);
        }
    });
    newsItems = Array.from(uniqueNewsMap.values());

    console.log(`Зібрано ${newsItems.length} новин з категорій за попередній день.`);

    // Функція для отримання повного тексту новини
    const fetchContent = async (news) => {
        try {
            const response = await axios.get(news.link, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
                }
            });
            const newsPage = load(response.data);
            // Витягування тексту з <div class="article-content columns-two">
            const contentTag = newsPage('.article-content.columns-two');

            if (!contentTag.length) {
                console.warn(`Контент новини за посиланням ${news.link} не знайдено.`);
                news.content = 'Текст новини відсутній.';
                return;
            }

            // Збір тексту з усіх <p> елементів
            const paragraphs = contentTag.find('p').map((i, el) => {
                // Видаляємо посилання та інші тегів, залишаючи лише текст
                return newsPage(el).text().trim();
            }).get();

            const content = paragraphs.join('\n\n');
            news.content = content || 'Текст новини відсутній.';
        } catch (error) {
            console.error(`Помилка при завантаженні новини за посиланням ${news.link}:`, error);
            news.content = 'Не вдалося отримати текст новини.';
        }
    };

    // Функція для обмеження кількості одночасних запитів
    const limit = (max) => {
        let current = 0;
        const queue = [];

        const next = () => {
            if (queue.length === 0 || current >= max) {
                return;
            }
            current++;
            const { fn, resolve, reject } = queue.shift();
            fn().then((val) => {
                current--;
                resolve(val);
                next();
            }).catch((err) => {
                current--;
                reject(err);
                next();
            });
        };

        return (fn) => {
            return new Promise((resolve, reject) => {
                queue.push({ fn, resolve, reject });
                process.nextTick(next);
            });
        };
    };

    const concurrencyLimit = 5;
    const limitedFetchContent = limit(concurrencyLimit);

    // Виконання запитів з обмеженням конкурентності
    const fetchPromises = newsItems.map(news => limitedFetchContent(() => fetchContent(news)));
    await Promise.all(fetchPromises);

    // Фільтрація новин з відсутнім або невдалим контентом
    newsItems = newsItems.filter(news => news.content && news.content !== 'Текст новини відсутній.' && news.content !== 'Не вдалося отримати текст новини.');

    console.log(`Після фільтрації залишилось ${newsItems.length} новин з наявним контентом.`);

    // Додаткова фільтрація: видалення дублікатів за заголовком, датою та текстом
    const uniqueContentMap = new Map();
    newsItems.forEach(news => {
        const key = `${news.title}-${news.date}-${news.content}`;
        if (!uniqueContentMap.has(key)) {
            uniqueContentMap.set(key, news);
        }
    });
    newsItems = Array.from(uniqueContentMap.values());

    console.log(`Після додаткової фільтрації залишилось ${newsItems.length} унікальних новин.`);

    // Збереження новин у JSON файл
    try {
        await fs.writeFile('processed_news.json', JSON.stringify(newsItems, null, 2), 'utf-8');
        console.log('Новини успішно збережено у файл processed_news.json');
    } catch (error) {
        console.error('Помилка при збереженні новин у файл:', error);
    }
}
    export default fetchNews;

