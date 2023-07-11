const url = require("url");
const cacheDb = require("../cache.json");

const cacheMiddleware = (req, res, next) =>{
    req.cacheKey = `/news${req.url}`;
    if(req.user && req.user.id){
        req.cacheKey+=`:${req.user.id}`;
    }
    let newTime = new Date();
    if([req.cacheKey] in cacheDb && new Date(cacheDb[req.cacheKey].expireAt) > newTime){
        return res.status(200).json({
            statusCode: 200,
            dateTime: new Date(),
            news: cacheDb[req.cacheKey].news
        });
    }else{
        next();
    }
}

module.exports = cacheMiddleware;