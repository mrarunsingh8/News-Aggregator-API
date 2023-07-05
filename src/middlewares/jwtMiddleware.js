const jwt = require("jsonwebtoken");

const jwtMiddleware = (req, res, next) => {
    let token = req.headers.authorization;
    if (token && token.trim().length !== 0 && token.startsWith('JWT ')) {
        token = token.slice(4, token.length);
        
        try{
            let decoded = jwt.verify(token, process.env.SECRET_KEY);
            req.user = decoded;
            return next();
        }catch(err){
            return next();
        }
    }
    return next(); 
}

module.exports = jwtMiddleware;