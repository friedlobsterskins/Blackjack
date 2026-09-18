'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {launchBrowser,ROOT} = require('./browser-smoke.cjs');

async function run() {
  const session = await launchBrowser();
  const {cdp,errors} = session;
  try {
    await cdp.send('Page.navigate',{url:pathToFileURL(path.join(ROOT,'index.html')).href});
    await cdp.waitFor(`!!document.querySelector('[data-zone]')`);
    await cdp.click('#tab-ultimate');
    for (const value of [5,500,50,25,100,5]) {
      await cdp.click(`[data-chip="${value}"]`);
      await cdp.click('[data-zone="ante"]');
    }
    assert.deepEqual(await cdp.evaluate(`[...document.querySelectorAll('[data-zone="ante"] .table-chip')].map(e=>Number(e.dataset.denomination))`),[500,100,50,25,25,5,5]);
    await cdp.click('[data-action="remove-chip"]');
    await cdp.click('[data-zone="ante"]');
    assert.deepEqual(await cdp.evaluate(`[...document.querySelectorAll('[data-zone="ante"] .table-chip')].map(e=>Number(e.dataset.denomination))`),[500,100,50,25,25,5]);
    for(const [width,height] of [[1365,768],[1920,1080],[768,1024],[390,844],[360,640],[320,568],[844,390],[1024,600]]) {
      await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<651});
      await cdp.screenshot(`fit-${width}x${height}.png`);
      const layout = await cdp.evaluate(`(() => {
        const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom}};
        const selectors=['.topbar','.control-deck','.chip-selector','.game-actions','#deal-btn','.table-limits','.felt-paytable','.community-zone','.poker-spot','.zone-value'];
        return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,rects:selectors.flatMap(s=>[...document.querySelectorAll(s)].filter(e=>e.getClientRects().length).map(e=>({s,...rect(e)}))),paytable:rect(document.querySelector('.felt-paytable')),board:rect(document.querySelector('.community-zone'))};
      })()`);
      assert.ok(layout.scrollWidth<=width && layout.scrollHeight<=height,`No scroll ${width}x${height}`);
      for(const r of layout.rects) assert.ok(r.x>=-1 && r.y>=-1 && r.right<=width+1 && r.bottom<=height+1,`Fits ${width}x${height}: ${JSON.stringify(r)}`);
      const a=layout.paytable,b=layout.board;
      assert.ok(a.right<=b.x || b.right<=a.x || a.bottom<=b.y || b.bottom<=a.y,`Payouts clear board ${width}x${height}: ${JSON.stringify({a,b})}`);
    }
    await cdp.click('#fullscreen-btn');
    await cdp.waitFor(`!!document.fullscreenElement`);
    assert.equal(await cdp.evaluate(`document.documentElement.scrollHeight<=innerHeight && document.documentElement.scrollWidth<=innerWidth && document.querySelector('.control-deck').getBoundingClientRect().bottom<=innerHeight`),true);
    await cdp.evaluate(`document.exitFullscreen()`);
    assert.deepEqual(errors,[]);
    console.log('PASS Sorted mixed denominations, removal, viewport fit at eight sizes and native fullscreen.');
  } finally { await session.close(); }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
