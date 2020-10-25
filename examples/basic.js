const express = require("express");
const gitMiddleware = require("../lib/index").default;

const app = express();
const port = 3000;

app.use(gitMiddleware({
	repositoryResolver: (repositoryPath) => {
		return {
			authorizationMode: "push-only",
			gitRepositoryDirectory: "/home/mwguy/vgit/test/test"
		}
	},
	authorize: (repositoryPath, credentials) => {
		return credentials.username === "admin" && credentials.password === "admin";
	}
}));

app.get('/', (req, res) => {
	res.send('Hello World!')
});

app.listen(port, () => {
	console.log(`Example app listening at http://localhost:${port}`)
});
