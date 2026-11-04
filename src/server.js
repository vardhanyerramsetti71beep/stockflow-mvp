// Local / traditional hosting entry point. On Vercel, src/app.js is used directly.
const app = require('./app');

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`StockFlow running at http://localhost:${port}`);
});
