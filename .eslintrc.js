module.exports = {
    "env": {
        "browser": false,
        "commonjs": false,
        "es2021": false,
		"node":true,
		"es6":true
    },
	"parser": "babel-eslint",
    "extends": "eslint:recommended",
    "parserOptions": {
        "ecmaVersion": 12
    },
    "rules": {
		"no-unused-vars": ["error", { "args": "none" }],
		
    }
};
