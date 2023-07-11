const chai = require("chai");
const sinon = require("sinon");
const chaiHttp = require("chai-http");
const path = require("path");
const fs = require("fs");

const app = require("./../../src/app");

chai.use(chaiHttp);

var authToken;

const setAuthToken = (token) => {
  authToken = token;
};

describe("/register User Registration", () => {
  beforeEach(function (done) {
    let filePath = path.join(
      __dirname,
      "../",
      "../",
      "src",
      `${process.env.FILE_DB_NAME}`
    );
    fs.writeFileSync(filePath, JSON.stringify({}), {
      encoding: "utf8",
      flag: "w",
    });
    done();
  });

  it("/register should register a user", (done) => {
    const userMock = {
      name: "Test user",
      email: "test@gmail.com",
      password: "test@123",
    };
    chai
      .request(app)
      .post("/register")
      .send(userMock)
      .end((err, res) => {
        if (err) {
          return done(err);
        }
        const { body } = res;
        chai.expect(res).status(201);
        chai.expect(body).property("statusCode");
        chai.expect(body).property("dateTime").that.is.a("string");
        chai.expect(body).property("message").that.is.an("string");
      });

    done();
  });

  it("/register should through a validation error", (done) => {
    const userMock = {
      name: "",
      email: "",
      password: "",
    };
    chai
      .request(app)
      .post("/register")
      .send(userMock)
      .end((err, res) => {
        if (err) {
          return done(err);
        }
        chai.expect(res).to.have.status(400);
        chai.expect(res.body).to.have.property("message");
        chai.expect(res.body).to.have.property("errors");
        chai.expect(res.body).to.have.property("errors").that.is.an("array");
      });

    done();
  });

  it("/register should through a user already Exist error", (done) => {
    const userMock = {
      name: "Test user",
      email: "test@gmail.com",
      password: "test@123",
    };
    chai
      .request(app)
      .post("/register")
      .send(userMock)
      .end((err, res) => {
        if (err) {
          return done(err);
        }
        chai.expect(res).to.have.status(400);
        chai
          .expect(res.body)
          .to.have.property("message")
          .equals("Email Already Exist.");
        chai.expect(res.body).to.have.property("errors");
      });

    done();
  });
});

describe("/login Login User", () => {
  it("/login validation error", (done) => {
    const userMock = {
      email: "test1@gmail.com",
      password: "",
    };
    chai
      .request(app)
      .post("/login")
      .send(userMock)
      .end((err, res) => {
        if (err) {
          return done(err);
        }
        const { body } = res;
        chai.expect(res).to.have.status(400);
        chai.expect(body).to.have.property("statusCode");
        chai.expect(body).to.have.property("dateTime").that.is.a("string");
        chai
          .expect(body)
          .to.have.property("message")
          .that.is.an("string")
          .equals("Validation error.");
      });

    done();
  });

  it("/login Email not exist error", (done) => {
    const userMock = {
      email: "test1@gmail.com",
      password: "test@1234",
    };
    chai
      .request(app)
      .post("/login")
      .send(userMock)
      .end((err, res) => {
        if (err) {
          return done(err);
        }
        const { body } = res;
        chai.expect(res).to.have.status(400);
        chai.expect(body).to.have.property("statusCode");
        chai.expect(body).to.have.property("dateTime").that.is.a("string");
        chai
          .expect(body)
          .to.have.property("message")
          .that.is.an("string")
          .equals("Email is not exist.");
      });

    done();
  });

  it("/login should Password doesn't match error", (done) => {
    const userMock = {
      email: "test@gmail.com",
      password: "test@1234",
    };
    chai
      .request(app)
      .post("/login")
      .send(userMock)
      .end((err, res) => {
        if (err) {
          return done(err);
        }
        const { body } = res;
        chai.expect(res).to.have.status(400);
        chai.expect(body).to.have.property("statusCode");
        chai.expect(body).to.have.property("dateTime").that.is.a("string");
        chai
          .expect(body)
          .to.have.property("message")
          .that.is.an("string")
          .equals("Password doesn't match.");
      });

    done();
  });

  it("/login should login a user", (done) => {
    const userMock = {
      email: "test@gmail.com",
      password: "test@123",
    };
    chai
      .request(app)
      .post("/login")
      .send(userMock)
      .end((err, res) => {
        if (err) {
          return done(err);
        }
        const { body } = res;
        chai.expect(res).to.have.status(200);
        chai.expect(body).to.have.property("statusCode");
        chai.expect(body).to.have.property("dateTime").that.is.a("string");
        chai
          .expect(body)
          .to.have.property("message")
          .that.is.an("string")
          .equals("Login Successfull.");
        setAuthToken(`JWT ${body.token}`);
      });

    done();
  });

  
  after("Reset the DB after all the Login and registration", ()=>{
    beforeEach(function (done) {
      let filePath = path.join(
        __dirname,
        "../",
        "../",
        "src",
        `${process.env.FILE_DB_NAME}`
      );
      fs.writeFileSync(filePath, JSON.stringify({}), {
        encoding: "utf8",
        flag: "w",
      });
      done();
    });
  })

});

module.exports = {
  getAuthToken: () => authToken,
};
