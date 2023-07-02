const jwt = require("jsonwebtoken");

const authMiddleware = (req, res, next) => {
    if (req.headers && req.headers.authorization && req.headers.authorization.startsWith('JWT ')) {
        let token = req.headers.authorization.split(' ')[1];

        try {
            var decoded = jwt.verify(token, process.env.SECRET_KEY);
            req.user = decoded;
            next();
        } catch (err) {
            return res.status(401).json({
                statusCode: 401,
                dateTime: new Date(),
                message: 'Invalid token',
                //error: new Error('Invalid token')
            });
        }

    }
    return res.status(401).json({
        statusCode: 401,
        dateTime: new Date(),
        message: 'JWT token missing',
        error: new Error('JWT token missing')
    });
}

module.exports = authMiddleware;