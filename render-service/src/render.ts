import express from 'express';
import helmet from 'helmet';
import puppeteer from 'puppeteer';

const app = express();
app.use(helmet());

const ALLOWED = (process.env.ALLOWED_HOSTS || '').split(',').filter(Boolean);
function ok(u: string) {
  try { return ALLOWED.length === 0 || ALLOWED.includes(new URL(u).hostname); } catch { return false; }
}

app.get('/render', async (req, res) => {
  const url = req.query.url as string | undefined;
  if (!url) return res.status(400).send('missing url');
  if (!ok(url)) return res.status(403).send('forbidden');

  let browser;
  try {
    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: 'new'
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    // get HTML after JS executed
    const html = await page.content();
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err: any) {
    console.error('render error', err);
    res.status(500).send('render error: ' + (err.message || 'unknown'));
  } finally {
    if (browser) await browser.close();
  }
});

const port = Number(process.env.PORT || 4000);
app.listen(port, () => console.log(`render-service listening ${port}`));
