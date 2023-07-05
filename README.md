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

##### Register a user

```http
   GET /register
```

| Body | Type     | Description                       |
| :-------- | :------- | :-------------------------------- |
| `name`      | `string` | **Required**. name |
| `email`      | `string` | **Required**. password |
| `name`      | `string` | **Required**. password |

##### Login a user

| Body | Type     | Description                       |
| :-------- | :------- | :-------------------------------- |
| `email`      | `string` | **Required**. password |
| `name`      | `string` | **Required**. password |

##### Get Everything news

```http
  GET /news
```

##### Get news by users preference

```http
  GET /news
```


| Headers | Type     | Description                       |
| :-------- | :------- | :-------------------------------- |
| `Authorization`      | `JWT ${token}` | **Required**. JWT authentication token if get news by users preference |

##### Get the news by users preferences

```http
  GET /preferences
```

| Header | Type     | Description                       |
| :-------- | :------- | :-------------------------------- |
| `Authorization`      | `JWT ${token}` |  **Required**. JWT authentication token |

##### create the users news preferences

```http
  PUT /preferences
```

| Header | Type     | Description                       |
| :-------- | :------- | :-------------------------------- |
| `Authorization`      | `JWT ${token}` |  **Required**. JWT authentication token |

| Body | Type     | Description                       |
| :-------- | :------- | :-------------------------------- |
| `preference`      | `string` |  **Required**. Users preference |


##### Mark a news article as read

```http
  PUT /news/:id/read
```

| Header | Type     | Description                       |
| :-------- | :------- | :-------------------------------- |
| `Authorization`      | `JWT ${token}` |  **Required**. JWT authentication token |

| Parameter | Type     | Description                       |
| :-------- | :------- | :-------------------------------- |
| `id`      | `string` |  **Required**. newsId |


| Body | Type     | Description                       |
| :-------- | :------- | :-------------------------------- |
| `newsData`      | `Object` |  **Required**. newsData |

##### Get the user's read news

```http
  GET /news/read
```

| Header | Type     | Description                       |
| :-------- | :------- | :-------------------------------- |
| `Authorization`      | `JWT ${token}` |  **Required**. JWT authentication token |


##### Mark a news article as favorite

```http
  PUT /news/:id/favorite
```

| Header | Type     | Description                       |
| :-------- | :------- | :-------------------------------- |
| `Authorization`      | `JWT ${token}` |  **Required**. JWT authentication token |

| Parameter | Type     | Description                       |
| :-------- | :------- | :-------------------------------- |
| `id`      | `string` |  **Required**. newsId |


| Body | Type     | Description                       |
| :-------- | :------- | :-------------------------------- |
| `newsData`      | `Object` |  **Required**. newsData |

##### Get the favorite news by users

```http
  GET /news/favorite
```

| Header | Type     | Description                       |
| :-------- | :------- | :-------------------------------- |
| `Authorization`      | `JWT ${token}` |  **Required**. JWT authentication token |



