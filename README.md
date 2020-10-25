# git-express

Simple library providing middleware for express server to easy build git server

### Install

```bash
$ npm i git-express
```

### Example

```typescript
import gitMiddleware, { AuthorizationCredentials, GitMiddlewareAuthorizationMode } from "git-express";

const app = express();
const port = 3000;

app.use(gitMiddleware({
	repositoryResolver: (repositoryPath: string) => {
		return {
			authorizationMode: GitMiddlewareAuthorizationMode.PUSH_ONLY,
			gitRepositoryDirectory: "/path/to/repos/base/" + repositoryPath
		}
	},
	authorize: (repositoryPath: string, credentials: AuthorizationCredentials) => {
		return credentials.username === "admin" && credentials.password === "admin";
	}
}));

app.get('/', (req, res) => {
	res.send('Hello World!')
});

app.listen(port, () => {
	console.log(`Example app listening at http://localhost:${port}`)
});

```
