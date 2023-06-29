# News-Aggregator-API
Build a RESTful API that allows users to fetch news articles from multiple sources based on their preferences.


## Author
- [@arun](https://github.com/mrarunsingh8)

## How to run

Clone the project

```bash
  git clone https://github.com/mrarunsingh8/News-Aggregator-API
```

Go to the project directory

```bash
  cd News-Aggregator-API
```

Install dependencies

```bash
  npm install
```

Start the server for development mode

```bash
  npm run dev
```
It will start a server for development use with url http://localhost:3000/.

Start the server production mode

```bash
  npm run start
```
It will start a server for production use.


## API Reference

#### Get `news`

##### Get all news

```http
  GET /api/news
```

##### Get a perticular `news` by id

```http
  GET /api/news/${id}
```

| Parameter | Type     | Description                       |
| :-------- | :------- | :-------------------------------- |
| `id`      | `string` | **Required**. Id of News to fetch |

#### Create a new news

```http
  POST /api/news/
```

| Body | Type     | Description                       |
| :-------- | :------- | :-------------------------------- |
| `id`      | `string` | **Required**. Id of News |
| `title`      | `string` | **Optional**. title of News |
| `description`      | `string` | **Optional**. description of News |


#### Update a news

```http
  PUT /api/news/
```

| Body | Type     | Description                       |
| :-------- | :------- | :-------------------------------- |
| `id`      | `string` | **Required**. Id of News |
| `title`      | `string` | **Optional**. title of News |
| `description`      | `string` | **Optional**. description of News |


#### Partial Update a News

##### Update the `title` for a news

```http
  PATCH /api/news/
```

| Body | Type     | Description                       |
| :-------- | :------- | :-------------------------------- |
| `id`      | `string` | **Required**. Id of News |
| `title`      | `string` | **Required**. title of News |

#### Delete a news by id

```http
  DELETE /api/news/${id}
```

| Parameter | Type     | Description                       |
| :-------- | :------- | :-------------------------------- |
| `id`      | `string` | **Required**. Id of News to delete |

