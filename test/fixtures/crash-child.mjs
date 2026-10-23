import { Store } from '../../src/store.mjs';
import { locations } from '../../src/paths.mjs';
import { snapshot,NOW } from '../helpers.mjs';
const store=new Store(locations(process.argv[2]));
store.reserve('account-a','FIVE_HOUR',snapshot(),NOW);
// Deliberate abrupt exit: no close/finally, exercising SQLite crash recovery.
process.exit(73);
