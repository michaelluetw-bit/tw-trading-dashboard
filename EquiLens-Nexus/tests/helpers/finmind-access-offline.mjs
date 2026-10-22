// Explicit local-only integration fixture; never reads OS credentials.
const localFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
 const u=new URL(String(url?.url||url));
 if(['localhost','127.0.0.1'].includes(u.hostname))return localFetch(url,options);
 if(u.hostname==='api.web.finmindtrade.com')return Response.json({status:200,api_request_limit:100,level:99,level_title:'fixture-sponsor'});
 return Response.json({status:200,data:[]});
};

