import { runWorker } from '../../src/worker.mjs';
import { locations } from '../../src/paths.mjs';
import { snapshot,fakeCreds } from '../helpers.mjs';
await runWorker(locations(process.argv[2]),{
  endpoint:process.argv[3],credentials:fakeCreds,interval:50,notify:()=>{},
  api:{snapshot:async()=>snapshot({five:20,week:30}),use:async()=>{throw new Error('No POST allowed');}}
});
