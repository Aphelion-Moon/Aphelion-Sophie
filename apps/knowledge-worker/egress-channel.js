import { aiBootPipe, authenticateAiBootPipe } from './boot-pipe.js';

export const aiEgressPipe = identity => aiBootPipe(identity,'egress');
export const authenticateAiEgress = options => authenticateAiBootPipe({...options,
  side:options.side==='bridge'?'host':options.side,purpose:'egress'});
