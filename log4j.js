
module.exports = {
	"appenders": {
		"out": {
			"type": "stdout"
		},
		"debug": {
			"type": "file",
			"filename": "./logs/debug.log",
			"maxLogSize": 10480000,
			"backups": 100
		},
		"result": {
			"type": "file",
			"filename": "./logs/result.log",
			"maxLogSize": 10480000,
			"backups": 100
		},
		"console": {
			"type": "file",
			"filename": "./logs/console.log",
			"maxLogSize": 10480000,
			"backups": 100
		}
	},
	"categories": {
		"default": {
			"appenders": [
				"out"
			],
			"level": "debug"
		},
		"##": {
			"appenders": [
				"debug"
			],
			"level": "debug"
		},
		"**": {
			"appenders": [
				"result"
			],
			"level": "debug"
		},
		"@@": {
			"appenders": [
				"out",
				"console"
			],
			"level": "info"
		}
	}
}
