// SYNTHETIC demo/test data. Not real housing data and not a quality claim.
// Seeded and deterministic: price is a known linear relation plus noise, so a
// future trainer test can check that the relation is recovered.
//   price_thb = 52000*area_sqm + 180000*bedrooms - 25000*age_years
//               + {central:900000, north:250000, east:0}[district] + 400000 + noise
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
export const SYNTHETIC_CSV=fileURLToPath(new URL('./synthetic-house-prices.csv',import.meta.url));
function mulberry32(seed){let a=seed>>>0;return ()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};}
export const DISTRICT_PREMIUM=Object.freeze({central:900000,north:250000,east:0});
export function syntheticHousePrices({rows=200,seed=20261126}={}){
  const r=mulberry32(seed),districts=Object.keys(DISTRICT_PREMIUM),out=['area_sqm,bedrooms,age_years,district,price_thb'];
  for(let i=0;i<rows;i++){
    const area=Math.round(30+r()*170),bedrooms=1+Math.floor(r()*4),age=Math.floor(r()*30),district=districts[Math.floor(r()*districts.length)];
    const noise=Math.round((r()+r()+r()-1.5)*300000);
    const price=52000*area+180000*bedrooms-25000*age+DISTRICT_PREMIUM[district]+400000+noise;
    out.push([area,bedrooms,age,district,price].join(','));
  }
  return out.join('\n')+'\n';
}
export const readSyntheticCsv=()=>Promise.resolve(syntheticHousePrices());
if(process.argv[1]===fileURLToPath(import.meta.url)){await writeFile(SYNTHETIC_CSV,syntheticHousePrices());console.log(`Wrote ${SYNTHETIC_CSV} (synthetic, seeded)`);void readFile;}
