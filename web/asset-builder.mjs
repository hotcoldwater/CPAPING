import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,readdirSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';

// Resolve local script dependencies before hashing, including lazy-loaded auth.js.
export function buildAssetFiles(out) {
 const names=readdirSync(out).filter(name=>/\.(js|css)$/.test(name));
 const sources=new Map(names.map(name=>['/'+name,readFileSync(join(out,name),'utf8')]));
 const versions={},visiting=new Set();mkdirSync(join(out,'assets'),{recursive:true});
 function build(path){
  if(versions[path])return versions[path];
  if(visiting.has(path))throw new Error('Circular asset dependency: '+path);
  visiting.add(path);
  const content=sources.get(path).replace(/(["'])(\/[A-Za-z0-9_.-]+\.(?:js|css))\1/g,
   (match,quote,dependency)=>sources.has(dependency)?quote+build(dependency)+quote:match);
  const hash=createHash('sha256').update(content).digest('hex').slice(0,16);
  const target='/assets'+path.replace(/(\.[^.]+)$/,'.'+hash+'$1');
  writeFileSync(join(out,target.slice(1)),content);writeFileSync(join(out,path.slice(1)),content);
  versions[path]=target;visiting.delete(path);return target;
 }
 for(const path of sources.keys())build(path);
 return versions;
}
