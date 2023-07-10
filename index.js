const app = require("./src/app");

app.listen(3000, (err)=>{
    if(err) console.error("Error", err);
    console.log("Server started on Port: 3000");
});