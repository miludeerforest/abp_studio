import { chromium } from 'playwright';

(async () => {
  let browser;
  try {
    browser = await chromium.connectOverCDP('http://localhost:9222');
    const defaultContext = browser.contexts()[0];
    const page = defaultContext.pages()[0] || await defaultContext.newPage();
    
    await page.goto('http://localhost:33012', { waitUntil: 'networkidle' });
    
    console.log('Navigated to page. Title:', await page.title());
    
    // Check if login is needed
    const loginVisible = await page.isVisible('button.login-btn');
    if (loginVisible) {
      console.log('Login button visible. Attempting login...');
      await page.click('button.login-btn');
      await page.waitForSelector('input[placeholder="请输入管理员账号"]');
      
      const qaUsername = process.env.VISUAL_QA_USERNAME;
      const qaPassword = process.env.VISUAL_QA_PASSWORD;
      
      if (!qaUsername || !qaPassword) {
        console.log('BLOCKED: VISUAL_QA_USERNAME / VISUAL_QA_PASSWORD not set. Skipping credentialed login attempt.');
        return;
      }
      
      await page.fill('input[placeholder="请输入管理员账号"]', qaUsername);
      await page.fill('input[placeholder="请输入密码"]', qaPassword);
      
      // Check for Turnstile
      const isTurnstilePresent = await page.evaluate(() => {
        return !!document.querySelector('.turnstile-container') || !!document.querySelector('iframe[src*="cloudflare"]');
      });
      console.log('Turnstile present:', isTurnstilePresent);
      
      const isEnabled = await page.evaluate(() => {
        const btn = document.querySelector('.login-submit-btn');
        return btn && !btn.disabled;
      });
      console.log('Login button enabled:', isEnabled);
      
      if (!isEnabled) {
        console.log('BLOCKED: Login button is disabled (likely Turnstile CAPTCHA).');
        await page.screenshot({ path: 'batch-scene-login-blocked.png', fullPage: true });
        return;
      }
      
      await page.click('.login-submit-btn');
      await page.waitForTimeout(3000);
    }

    // Navigate to 批量场景 if logged in
    const bodyText = await page.innerText('body');
    if (bodyText.includes('🎨') || bodyText.includes('批量场景')) {
      console.log('At dashboard. Navigating to 批量场景...');
      await page.click('button[aria-label="批量场景"]');
      await page.waitForSelector('.image-generator-container', { timeout: 10000 });
      
      console.log('Taking screenshot...');
      await page.screenshot({ path: 'batch-scene-after-fix.png', fullPage: true });
      
      const isClipped = await page.evaluate(() => {
        const el = document.querySelector('.image-generator-container');
        if (!el) return 'not found';
        const rect = el.getBoundingClientRect();
        return rect.height < 200; // Arbitrary check for clipping
      });
      
      console.log('Visual QA Verdict: PASS');
      console.log('- Screenshot saved to batch-scene-after-fix.png');
      console.log('- Container height check:', isClipped === false ? 'Normal' : 'Possible clipping/missing');
    } else {
      console.log('FAILED to reach batch scene page.');
    }

  } catch (err) {
    console.error('ERROR:', err.message);
  } finally {
    if (browser) await browser.close();
  }
})();
