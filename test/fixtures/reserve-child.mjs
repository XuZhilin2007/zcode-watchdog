import { Store } from '../../src/store.mjs';
import { locations } from '../../src/paths.mjs';
import { snapshot,NOW } from '../helpers.mjs';
const store=new Store(locations(process.argv[2]));
try {store.reserve('account-a','WEEK',snapshot(),NOW);process.stdout.write('reserved');}
catch(e){process.stdout.write(e.code||'error');}
finally{store.close();}
