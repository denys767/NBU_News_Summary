// sendEmail.js
import processNews from './processNews.js';
import fetchNews from './fetchNews.js';
import fs from 'fs/promises';
import nodemailer from 'nodemailer';
import cron from 'node-cron';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Формування HTML контенту для листа
 * @param {Array} newsItems - Список новин з резюме
 * @returns {string} - HTML контент
 */
function createEmailContent(newsItems) {
  let html = `
    <h1>Щоденне зведення новин НБУ</h1>
    <p>Дата: ${new Date().toLocaleDateString()}</p>
    <ul>
  `;

  newsItems.forEach(news => {
    // Якщо дата відсутня, використовуємо текст "невказана"
    const pubDate = news.date ? news.date : 'невказана';
    // Якщо посилання відсутнє – можна показати повідомлення або не виводити блок "Читати далі"
    const readMoreLink = news.link ? `<p><a href="${news.link}">Читати далі</a></p>` : '<p>Посилання відсутнє</p>';

    html += `
      <li style="margin-bottom: 20px;">
        <h2>${news.title}</h2>
        <p><strong>Категорія:</strong> ${news.category}</p>
        <p><strong>Дата публікації:</strong> ${pubDate}</p>
        <p>${news.summary}</p>
        ${readMoreLink}
      </li>
    `;
  });

  html += '</ul>';
  return html;
}

/**
 * Відправка електронного листа
 */
async function sendEmail() {
  try {
    const data = await fs.readFile('summarized_news.json', 'utf-8');
    const newsItems = JSON.parse(data);

    if (newsItems.length === 0) {
      console.log('Немає новин для відправки.');
      return;
    }

    const htmlContent = createEmailContent(newsItems);

    // Налаштування Nodemailer
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS, // Використовуйте пароль додатка
      },
    });

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_RECIPIENTS, // Можна вказати кілька адрес через кому
      subject: 'Щоденне зведення новин НБУ',
      html: htmlContent,
    };

    // Відправка листа
    await transporter.sendMail(mailOptions);
    console.log('Електронний лист успішно відправлений.');
  } catch (error) {
    console.error('Помилка при відправці електронного листа:', error);
  }
}

/**
 * Функція для обробки та відправки новин
 */
async function processAndSend() {
  try {
    console.log('Початок процесу збору новин...');
    await fetchNews();
    console.log('Збір новин завершено.');

    console.log('Початок обробки новин...');
    await processNews();
    console.log('Обробка новин завершена.');

    console.log('Початок відправки електронного листа...');
    await sendEmail();
    console.log('Відправка електронного листа завершена.');
  } catch (error) {
    console.error('Помилка при обробці та відправці новин:', error);
  }
}

// Налаштування cron для запуску щодня о 20:00 вечора
cron.schedule('0 20 * * *', () => {
  console.log('Запуск cron завдання: Збір, обробка та відправка новин.');
  processAndSend();
}, {
  timezone: "Europe/Kiev" // Встановіть свій часовий пояс
});

// Запуск процесу один раз при старті скрипту (опціонально)
processAndSend();

// Експорт (опціонально, якщо потрібно використовувати sendEmail як модуль)
export { sendEmail };
