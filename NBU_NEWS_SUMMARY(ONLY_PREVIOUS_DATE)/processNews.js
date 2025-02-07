// processNews.js
import fs from 'fs/promises';
import OpenAI from "openai";
import dotenv from 'dotenv';

dotenv.config();

// Налаштування OpenAI
const openai = new OpenAI();
openai.apiKey = process.env.OPENAI_API_KEY;
/**
 * Функція для створення резюме за допомогою GPT
 * @param {string} content - Повний текст новини
 * @returns {string} - Коротке резюме
 */
async function summarizeNews(content) {
    try {
        const prompt = `Створи коротку вижимку цієї новини 1-2 речення. Не обрізай підсумок на полуслові!:\n\n${content}`;
        
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "Ти допомагаєш створювати короткі вижимки (підсумки) новин." },
                { role: "user", content: prompt }
            ],
            max_tokens: 1500,
            temperature: 0.5,
        });

        const summary = response.choices[0].message.content.trim();
        return summary;
    } catch (error) {
        console.error('Помилка при створенні резюме:', error);
        return 'Не вдалося створити резюме.';
    }
}

/**
 * Обробка новин та створення резюме
 */
async function processNews() {
    try {
        const data = await fs.readFile('processed_news.json', 'utf-8');
        const newsItems = JSON.parse(data);

        for (let news of newsItems) {
            if (news.content && news.content !== 'Текст новини відсутній.' && news.content !== 'Не вдалося отримати текст новини.') {
                news.summary = await summarizeNews(news.content);
                // Додаємо дату обробки
                news.processedDate = new Date().toISOString();
            } else {
                news.summary = 'Немає доступного контенту для резюме.';
            }
        }

        // Фільтрація новин з відсутнім резюме
        const validNews = newsItems.filter(news => news.summary && news.summary !== 'Немає доступного контенту для резюме.' && news.summary !== 'Не вдалося створити резюме.');

        // Зберігаємо оброблені новини
        await fs.writeFile('summarized_news.json', JSON.stringify(validNews, null, 2), 'utf-8');
        console.log('Новини успішно оброблені та збережені у файл summarized_news.json');
    } catch (error) {
        console.error('Помилка при обробці новин:', error);
    }
}

export default processNews;

// Для тестування
if (process.argv[1].endsWith('processNews.js')) {
    processNews();
}
