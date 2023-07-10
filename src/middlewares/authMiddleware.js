const jwt = require("jsonwebtoken");

const authMiddleware = (req, res, next) => {
    let token = req.headers.authorization;
    if (token && token.trim().length !== 0 && token.startsWith('JWT ')) {
        token = token.slice(4, token.length);

        try {
            var decoded = jwt.verify(token, process.env.SECRET_KEY);
            req.user = decoded;
            next();
        } catch(err) {
            res.status(401).json({
                statusCode: 401,
                dateTime: new Date,
                message: "Unauthorized access!"
            })
        }
    }else{
        return res.status(401).json({
            statusCode: 401,
            dateTime: new Date(),
            message: 'JWT token missing',
            error: new Error('JWT token missing')
        });
    }
}

module.exports = authMiddleware;