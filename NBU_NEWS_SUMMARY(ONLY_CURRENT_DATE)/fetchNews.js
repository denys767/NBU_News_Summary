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
  'груд.': 11   // December
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
  { id: 'tabs-documents-5-0', name: 'Останні Звіти' },
  { id: 'tabs-documents-5-1', name: 'Стратегічні Документи' },
  { id: 'tabs-documents-5-2', name: 'Інші' }
];

/**
 * Функція для збору новин з сайту НБУ.
 *
 * @param {Object} options - Опції функції.
 * @param {boolean} options.ignoreDate - Якщо true, то ігнорується фільтрація за датою (для тестування).
 * @returns {Array} - Масив об'єктів новин.
 */
async function fetchNews(options = { ignoreDate: false }) {
  let html;
  try {
    const response = await axios.get(NEWS_SECTION, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    html = response.data;
  } catch (error) {
    console.error('Помилка при завантаженні сторінки новин:', error);
    return [];
  }

  const $ = load(html);
  let newsItems = [];
  const today = new Date();
  const todayDay = today.getDate();
  const todayMonth = today.getMonth();
  const todayYear = today.getFullYear();

  // Завантаження відстежуваних стратегічних документів із файлу (якщо існує)
  let strategicDocsExisting = [];
  try {
    const data = await fs.readFile('strategic_docs.json', 'utf-8');
    strategicDocsExisting = JSON.parse(data);
  } catch (e) {
    strategicDocsExisting = [];
  }
  // Масив для посилань, знайдених під час поточного парсингу стратегічних документів
  const strategicDocsFound = [];

  // Проходимо по всіх категоріях
  for (const category of categories) {
    const container = $(`#${category.id}`);
    if (!container.length) {
      console.warn(`Контейнер з ID "${category.id}" не знайдено.`);
      continue;
    }
    container.find('.collection-item.post-inline').each((index, element) => {
      // === Категорія "Стратегічні Документи" (без фільтрації дати) ===
      if (category.name === 'Стратегічні Документи') {
        const descriptionDiv = $(element).find('.description');
        if (!descriptionDiv.length) {
          console.warn(`Елемент .description не знайдено для елемента в категорії "${category.name}".`);
          return;
        }
        const titleText = descriptionDiv.text().trim();
        let downloadLink = null;
        $(element).find('a').each((i, el) => {
          const linkText = $(el).text().trim();
          if (linkText.includes('Завантажити')) {
            downloadLink = $(el).attr('href');
            if (downloadLink && !downloadLink.startsWith('http')) {
              downloadLink = new URL(downloadLink, BASE_URL).href;
            }
          }
        });
        if (downloadLink) {
          if (!strategicDocsFound.includes(downloadLink)) {
            strategicDocsFound.push(downloadLink);
          }
          if (strategicDocsExisting.includes(downloadLink)) {
            return;
          }
          newsItems.push({
            title: titleText,
            link: downloadLink,
            date: null,
            category: category.name
          });
        } else {
          console.warn(`Пропускаємо елемент в категорії "${category.name}" через відсутність посилання.`);
        }
      }
      // === Категорія "Інші" ===
      else if (category.name === 'Інші') {
        const descriptionDiv = $(element).find('.description');
        if (!descriptionDiv.length) {
          console.warn(`Елемент .description не знайдено для елемента в категорії "${category.name}".`);
          return;
        }
        const titleText = descriptionDiv.text().trim();
        let downloadLink = null;
        $(element).find('a').each((i, el) => {
          const linkText = $(el).text().trim();
          if (linkText.includes('Завантажити')) {
            downloadLink = $(el).attr('href');
            if (downloadLink && !downloadLink.startsWith('http')) {
              downloadLink = new URL(downloadLink, BASE_URL).href;
            }
          }
        });
        let newsDate = null;
        if (downloadLink) {
          const dateMatch = downloadLink.match(/(\d{4}-\d{2}-\d{2})/);
          if (dateMatch) {
            const dateStr = dateMatch[1];
            newsDate = new Date(dateStr);
          } else {
            console.warn(`Не вдалося витягти дату з посилання: ${downloadLink}`);
          }
        }
        if (titleText && downloadLink) {
          if (
            options.ignoreDate ||
            (newsDate &&
              newsDate.getDate() === todayDay &&
              newsDate.getMonth() === todayMonth &&
              newsDate.getFullYear() === todayYear)
          ) {
            newsItems.push({
              title: titleText,
              link: downloadLink,
              date: newsDate ? newsDate.toLocaleDateString('uk-UA') : null,
              category: category.name
            });
          }
        }
      }
      // === Категорія "Останні Звіти" (оновлено з фільтрацією за датою) ===
      else if (category.name === 'Останні Звіти') {
        // Заголовок знаходиться всередині <p><a>…</a></p>
        const anchor = $(element).find('p a');
        if (!anchor.length) {
          console.warn(`Не знайдено <a> в категорії "${category.name}"`);
          return;
        }
        const titleText = anchor.text().trim();
        let postLink = anchor.attr('href');
        if (postLink && !postLink.startsWith('http')) {
          postLink = new URL(postLink, BASE_URL).href;
        }
        // Витягуємо дату з елемента <time> (наприклад, "4 лют. 2025 10:09")
        let newsDate = null;
        const timeText = $(element).find('.mark time').text().trim();
        const timeParts = timeText.split(' ');
        if (timeParts.length >= 3) {
          const day = parseInt(timeParts[0], 10);
          const monthAbbr = timeParts[1];
          const year = parseInt(timeParts[2], 10);
          if (!isNaN(day) && MONTH_MAP[monthAbbr] !== undefined && !isNaN(year)) {
            newsDate = new Date(year, MONTH_MAP[monthAbbr], day);
          }
        }
        // Фільтруємо: якщо ignoreDate === true або якщо дата дорівнює сьогоднішній
        if (titleText && postLink) {
          if (
            options.ignoreDate ||
            (newsDate &&
              newsDate.getDate() === todayDay &&
              newsDate.getMonth() === todayMonth &&
              newsDate.getFullYear() === todayYear)
          ) {
            newsItems.push({
              title: titleText,
              postLink, // посилання на сторінку посту
              link: null, // буде оновлено після отримання PDF‑посилання
              date: newsDate ? newsDate.toLocaleDateString('uk-UA') : null,
              category: category.name,
              isReport: true
            });
          }
        }
      }
      // === Інші категорії ("Новини", "Повідомлення", "Пряма Мова", "Усі") ===
      else {
        const titleTag = $(element).find('p > a');
        const title = titleTag.text().trim();
        let link = titleTag.attr('href');
        if (link) {
          if (!link.startsWith('http')) {
            link = new URL(link, BASE_URL).href;
          }
        }
        const timeText = $(element).find('.mark time').text().trim();
        let newsDate = null;
        if (/^\d{1,2}:\d{2}$/.test(timeText)) {
          newsDate = new Date(todayYear, todayMonth, todayDay);
        } else {
          const dateParts = timeText.split(' ');
          if (dateParts.length >= 3) {
            const day = parseInt(dateParts[0], 10);
            const monthAbbr = dateParts[1];
            let yearStr = dateParts[2].replace(/\D/g, '');
            const year = parseInt(yearStr, 10);
            if (!isNaN(day) && MONTH_MAP[monthAbbr] !== undefined && !isNaN(year)) {
              newsDate = new Date(year, MONTH_MAP[monthAbbr], day);
            } else {
              console.warn(`Невірний формат дати: ${timeText}`);
            }
          } else {
            console.warn(`Невірний формат дати: ${timeText}`);
          }
        }
        if (title && link) {
          if (
            options.ignoreDate ||
            (newsDate &&
              newsDate.getDate() === todayDay &&
              newsDate.getMonth() === todayMonth &&
              newsDate.getFullYear() === todayYear)
          ) {
            newsItems.push({
              title,
              link,
              date: newsDate ? newsDate.toLocaleDateString('uk-UA') : null,
              category: category.name
            });
          }
        }
      }
    });
  }

  // Оновлюємо JSON-файл для стратегічних документів
  try {
    await fs.writeFile('strategic_docs.json', JSON.stringify(strategicDocsFound, null, 2), 'utf-8');
    console.log('Стратегічні документи оновлено у файлі strategic_docs.json');
  } catch (error) {
    console.error('Помилка при збереженні стратегічних документів у файл:', error);
  }

  console.log(`Зібрано ${newsItems.length} новин з категорій.`);

  // Допоміжна функція для отримання PDF‑посилання зі сторінки посту
  async function getPdfDownloadLink(url) {
    try {
      const res = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      });
      const postPage = load(res.data);
      let pdfLink = null;
      postPage('a').each((i, el) => {
        const text = postPage(el).text().trim();
        if (text.includes('Завантажити')) {
          pdfLink = postPage(el).attr('href');
          if (pdfLink && !pdfLink.startsWith('http')) {
            pdfLink = new URL(pdfLink, BASE_URL).href;
          }
        }
      });
      return pdfLink;
    } catch (err) {
      console.error(`Помилка при отриманні PDF посилання з ${url}:`, err);
      return null;
    }
  }

  /**
   * Функція для отримання повного тексту новини.
   * Якщо посилання містить PDF, повертається текст із посиланням на PDF.
   */
  const fetchContent = async (news) => {
    // Для категорії "Останні Звіти" – отримуємо PDF‑посилання зі сторінки посту
    if (news.category === 'Останні Звіти' && news.isReport && news.postLink) {
      const pdfLink = await getPdfDownloadLink(news.postLink);
      if (pdfLink) {
        news.link = pdfLink;
        news.content = `PDF-файл: ${pdfLink}`;
      } else {
        news.content = "контент відсутній";
      }
      return;
    }
    if (!news.link) {
      console.warn(`Новина "${news.title}" не має посилання.`);
      if (!news.content) news.content = 'Посилання відсутнє.';
      return;
    }
    if (news.link.toLowerCase().includes('.pdf')) {
      news.content = `PDF-файл: ${news.link}`;
      return;
    }
    try {
      const response = await axios.get(news.link, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      });
      const newsPage = load(response.data);
      const contentTag = newsPage('.article-content');
      if (!contentTag.length) {
        console.warn(`Контент новини за посиланням ${news.link} не знайдено.`);
        news.content = 'Текст новини відсутній.';
        return;
      }
      const paragraphs = contentTag.find('p').map((i, el) => newsPage(el).text().trim()).get();
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
      if (queue.length === 0 || current >= max) return;
      current++;
      const { fn, resolve, reject } = queue.shift();
      fn()
        .then((val) => {
          current--;
          resolve(val);
          next();
        })
        .catch((err) => {
          current--;
          reject(err);
          next();
        });
    };
    return (fn) =>
      new Promise((resolve, reject) => {
        queue.push({ fn, resolve, reject });
        process.nextTick(next);
      });
  };

  const concurrencyLimit = 5;
  const limitedFetchContent = limit(concurrencyLimit);
  const fetchPromises = newsItems.map((news) => limitedFetchContent(() => fetchContent(news)));
  await Promise.all(fetchPromises);

  newsItems = newsItems.filter((news) =>
    news.content &&
    news.content !== 'Текст новини відсутній.' &&
    news.content !== 'Не вдалося отримати текст новини.'
  );

  console.log(`Після фільтрації залишилось ${newsItems.length} новин з наявним контентом.`);

  const uniqueContentMap = new Map();
  newsItems.forEach((news) => {
    const key = `${news.title}-${news.date}-${news.content}`;
    if (!uniqueContentMap.has(key)) uniqueContentMap.set(key, news);
  });
  newsItems = Array.from(uniqueContentMap.values());

  console.log(`Після додаткової фільтрації залишилось ${newsItems.length} унікальних новин.`);

  try {
    await fs.writeFile('processed_news.json', JSON.stringify(newsItems, null, 2), 'utf-8');
    console.log('Новини успішно збережено у файл processed_news.json');
  } catch (error) {
    console.error('Помилка при збереженні новин у файл:', error);
  }

  return newsItems;
}

export default fetchNews;
