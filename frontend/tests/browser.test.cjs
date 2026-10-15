// Browser regressions use the production Angular bundle and controlled API responses.
const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
let server, origin;
const medicine = {code:'MED0001',name:'Test Medicine',form:'tablet',strength_value:500,strength_unit:'mg',is_active:true};
const rule = {id:1,effective_from:'2020-01-01T22:00:00Z',effective_to:null,max_quantity_per_dispense:10,max_quantity_per_30_days:20,requires_authorisation:true};
const error = (message='Try again') => ({error:{code:'request_rejected',violations:[{code:'unavailable',field:'',message}]}});
before(async()=>{
  const root = path.resolve('dist/pharmacy/browser');
  server = http.createServer((req,res)=>{
    const requested = path.resolve(root,'.'+req.url.split('?')[0]);
    const file = requested.startsWith(root+path.sep) && fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.join(root,'index.html');
    res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  origin='http://127.0.0.1:'+server.address().port;
});
after(async()=>{await new Promise(resolve=>server?.close(resolve));});
async function setup(t, handler, init) {
  const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote','--single-process']});
  const context=await browser.newContext();
  if(init) await context.addInitScript(init);
  const page=await context.newPage();
  const browserErrors=[];
  page.on('pageerror',e=>browserErrors.push(e.message));
  t.after(async()=>{await context.close();await browser.close();assert.deepEqual(browserErrors,[]);});
  await page.route('**/api/v1/**',async route=>{
    if(handler && await handler(route,page))return;
    const url=new URL(route.request().url());
    const data=url.pathname.endsWith('/rules')?{data:[rule],next_cursor:null}:url.pathname.endsWith('/MED0001')?{data:{...medicine,current_rule:rule}}:url.pathname.endsWith('/dispenses')?{data:[],next_cursor:null}:{data:[medicine],next_cursor:null};
    await route.fulfill({json:data});
  });
  return page;
}
async function fill(page){
  await page.goto(origin+'/capture');
  await page.locator('#medicine').fill('MED0001');
  await page.locator('#patient').fill('SYNTHETIC-TEST');
  await page.locator('#quantity').fill('2');
  await page.locator('#at').fill('2026-10-15T18:30:45');
}
const submit=page=>page.getByRole('button',{name:'Submit dispense',exact:true}).click();
async function recorded(route,id=1){const body=route.request().postDataJSON();await route.fulfill({status:201,json:{data:{id,...body}}});}

test('seconds are valid, Johannesburg conversion is correct, CSP renders styles',async t=>{
  let body;
  const page=await setup(t,async route=>{if(route.request().method()==='POST'){body=route.request().postDataJSON();await recorded(route);return true;}});
  await fill(page);await submit(page);await page.getByText('Dispense #1 recorded.').waitFor();
  assert.equal(body.dispensed_at,'2026-10-15T16:30:45.000Z');
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('pharmacy.pending-dispense.v1')),null);
  assert.equal(await page.locator('body').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(246, 248, 250)');
});

test('lost response and refresh replay the exact payload and key',async t=>{
  const bodies=[];
  const page=await setup(t,async route=>{
    if(route.request().method()==='POST'){
      bodies.push(route.request().postDataJSON());
      if(bodies.length===1)await route.abort('failed');else await recorded(route,42);
      return true;
    }
  });
  await fill(page);await submit(page);
  await page.getByRole('button',{name:'Retry pending dispense'}).waitFor();
  assert.equal(await page.locator('#patient').isDisabled(),true);
  await page.reload();await page.getByRole('button',{name:'Retry pending dispense'}).click();
  await page.getByText('Dispense #42 recorded.').waitFor();
  assert.deepEqual(bodies[0],bodies[1]);
  assert.equal(await page.locator('#patient').isDisabled(),true);
  await page.getByRole('button',{name:'New dispense',exact:true}).click();
  assert.equal(await page.locator('#patient').inputValue(),'');
});

test('server rejections show all fields and editing rotates the key',async t=>{
  const bodies=[];
  const page=await setup(t,async route=>{
    if(route.request().method()==='POST'){
      bodies.push(route.request().postDataJSON());
      await route.fulfill({status:422,json:{error:{code:'request_rejected',violations:[
        {code:'per_dispense_limit',field:'quantity',message:'Single limit exceeded'},
        {code:'rolling_limit',field:'quantity',message:'Rolling limit exceeded'},
        {code:'authorisation_required',field:'authorisation_ref',message:'Reference required'},
      ]}}});return true;
    }
  });
  await fill(page);await submit(page);await page.getByText('Dispense not confirmed').waitFor();
  assert.equal(await page.locator('.error').count(),3);
  await submit(page);await page.waitForFunction(()=>document.querySelector('button[type="submit"]').textContent==='Submit dispense');
  assert.equal(bodies[0].idempotency_key,bodies[1].idempotency_key);
  await page.locator('#quantity').fill('1');await submit(page);
  await page.waitForFunction(()=>document.querySelector('button[type="submit"]').textContent==='Submit dispense');
  assert.notEqual(bodies[1].idempotency_key,bodies[2].idempotency_key);
});

test('storage failure stops the request before it is sent',async t=>{
  let posts=0;
  const page=await setup(t,async route=>{if(route.request().method()==='POST'){posts++;await recorded(route);return true;}},()=>{Storage.prototype.setItem=()=>{throw new Error('Storage disabled');};});
  await fill(page);await submit(page);await page.getByText('Request: Browser tab storage is unavailable. Enable it before submitting so retries remain safe.',{exact:true}).waitFor();assert.equal(posts,0);
});

test('whitespace references and fractional quantities cannot be submitted',async t=>{
  const page=await setup(t);await fill(page);await page.locator('#patient').fill('   ');
  assert.equal(await page.getByRole('button',{name:'Submit dispense',exact:true}).isDisabled(),true);
  await page.locator('#patient').fill('P');await page.locator('#quantity').fill('1.5');
  assert.equal(await page.getByRole('button',{name:'Submit dispense',exact:true}).isDisabled(),true);
});

test('malformed server errors do not crash the error renderer',async t=>{
  const page=await setup(t,async route=>{if(route.request().method()==='POST'){await route.fulfill({status:503,json:{error:{violations:{bad:true}}}});return true;}});
  await fill(page);await submit(page);await page.getByText('Request failed (503). Retry with the same request key.').waitFor();
});

test('failed Next preserves catalogue rows and retries the same cursor',async t=>{
  let nextCalls=0;
  const page=await setup(t,async route=>{
    const url=new URL(route.request().url());
    if(url.pathname.endsWith('/medicines')){
      if(url.searchParams.has('cursor')){nextCalls++;if(nextCalls===1)await route.fulfill({status:503,json:error()});else await route.fulfill({json:{data:[{...medicine,code:'MED0002',name:'Second'}],next_cursor:null}});}
      else await route.fulfill({json:{data:[medicine],next_cursor:'next'}});return true;
    }
  });
  await page.goto(origin+'/medicines');await page.getByText('Test Medicine',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Next',exact:true}).click();await page.getByRole('button',{name:'Retry current page'}).waitFor();
  assert.equal(await page.getByText('Test Medicine',{exact:true}).count(),1);
  await page.getByRole('button',{name:'Next',exact:true}).click();await page.getByText('Second',{exact:true}).waitFor();assert.equal(nextCalls,2);
});

test('failed ledger Next preserves rows and pagination position',async t=>{
  let attempts=0;
  const row={id:1,medicine_code:'MED0001',patient_ref:'P',quantity:1,dispensed_at:'2026-10-15T10:00:00Z'};
  const page=await setup(t,async route=>{
    const url=new URL(route.request().url());
    if(url.pathname.endsWith('/dispenses')){
      if(url.searchParams.has('cursor')){attempts++;if(attempts===1)await route.fulfill({status:503,json:error()});else await route.fulfill({json:{data:[{...row,id:2}],next_cursor:null}});}
      else await route.fulfill({json:{data:[row],next_cursor:'next'}});return true;
    }
  });
  await page.goto(origin+'/ledger?patient=P');await page.getByText('#1',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Next',exact:true}).click();await page.getByRole('button',{name:'Retry current page'}).waitFor();
  assert.equal(await page.getByText('#1',{exact:true}).count(),1);
  await page.getByRole('button',{name:'Next',exact:true}).click();await page.getByText('#2',{exact:true}).waitFor();assert.equal(attempts,2);
});

test('failed initial rule history has a working retry',async t=>{
  let attempts=0;
  const page=await setup(t,async route=>{if(new URL(route.request().url()).pathname.endsWith('/rules')){attempts++;if(attempts===1)await route.fulfill({status:503,json:error()});else await route.fulfill({json:{data:[rule],next_cursor:null}});return true;}});
  await page.goto(origin+'/medicines/MED0001');await page.getByRole('button',{name:'Retry rule history'}).click();
  await page.getByText('In force now',{exact:true}).waitFor();assert.equal(await page.locator('.timeline li').count(),1);
});

test('catalogue names are rendered as text, not executable HTML',async t=>{
  const name='<img src=x onerror="window.compromised=true">';
  const page=await setup(t,async route=>{await route.fulfill({json:{data:[{...medicine,name}],next_cursor:null}});return true;});
  await page.goto(origin+'/medicines');await page.getByText(name,{exact:true}).waitFor();
  assert.equal(await page.locator('main img').count(),0);assert.equal(await page.evaluate(()=>window.compromised),undefined);
});
