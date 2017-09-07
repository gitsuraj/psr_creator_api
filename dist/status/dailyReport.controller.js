'use strict';

Object.defineProperty(exports, "__esModule", {
	value: true
});

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _axios = require('axios');

var _axios2 = _interopRequireDefault(_axios);

var _moment = require('moment');

var _moment2 = _interopRequireDefault(_moment);

var _dailyReport = require('./dailyReport.service');

var _dailyReport2 = _interopRequireDefault(_dailyReport);

var _user = require('../models/user.js');

var _user2 = _interopRequireDefault(_user);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var dailyReportController = function dailyReportController() {
	var post = function post(req, res) {
		var query = req.body;
		var user = new _user2.default({
			username: query.username,
			reponame: query.reponame,
			token: query.token,
			date: query.date
		});

		if (!user.isValid()) {
			res.send({ 'error': 'Username and Reponame is mendatory!' });
			return;
		}

		_dailyReport2.default.getGitRepos(user, function (data) {
			onGitReposRetrievedSuccessfully(data, req, res);
		}, function (data) {
			onGitReposRetrievedFailed(data, res);
		});
	};

	var onGitReposRetrievedSuccessfully = function onGitReposRetrievedSuccessfully(data, req, res) {
		var query = req.body;
		if (data.status === 200) {
			var commits = _lodash2.default.get(data, 'data');
			var repoDatas = [];
			var promises = [];

			commits.forEach(function (c) {
				var createdDate = (0, _moment2.default)(c.created_at).format('YYYY-MM-DD');
				var queryDate = (0, _moment2.default)(query.date).format('YYYY-MM-DD');
				var repoData = {};

				//IF PUSHEVENT TYPE
				if (createdDate === queryDate && c.type === 'PushEvent') {
					var commit = _lodash2.default.get(c, 'payload.commits[0]') || [];
					if (_lodash2.default.get(commit, 'message').toLowerCase().indexOf('merge') === -1) {
						var _repoData = {
							commitMessage: commit.message,
							committedBy: commit.author.email,
							committedDate: c.created_at
						};
						repoDatas.push(_repoData);
					}
				}

				//IF PULLREQUESTEVENT TYPE
				if (createdDate === queryDate && c.type === 'PullRequestEvent') {
					promises.push(_axios2.default.get(_lodash2.default.get(c.payload.pull_request, 'commits_url'), {
						method: 'GET',
						isArray: true,
						headers: { 'Authorization': 'token ' + query.token }
					}));
				}
			}, repoDatas);

			_axios2.default.all(promises).then(function (result) {
				result.forEach(function (data) {
					var results = data.data;
					var repoData = {
						commitMessage: results[0].commit.message,
						committedBy: results[0].commit.author.email,
						committedDate: results[0].commit.author.date
					};
					repoDatas.push(repoData);
				}, undefined);
				onSuccess(repoDatas, res);
			});
		} else {
			res.send({ 'error': 'Unable to fetch data!' + data });
		}
	};

	var onGitReposRetrievedFailed = function onGitReposRetrievedFailed(data, res) {
		if (_lodash2.default.get(data, 'response.status') === 401) {
			res.send({ 'error': 'Unauthorized, Please use token generated by git' });
		} else {
			res.send({ 'error': 'Unable to fetch data!' + data });
		}
	};
	var getGitCommitsReport = function getGitCommitsReport(repoDatas, successFn) {
		var reportDatas = [];
		repoDatas.forEach(function (c) {
			var commitMessage = _lodash2.default.get(c, 'commitMessage') || '';
			var reportData = {
				committedBy: c.committedBy || '',
				committedDate: c.committedDate || '',
				taskId: _dailyReport2.default.getCleanSplittedData(commitMessage, 'space'),
				taskTitle: _dailyReport2.default.getCleanSplittedData(commitMessage, '-m'),
				taskTimeSpent: _dailyReport2.default.getTimeInMins(_dailyReport2.default.getCleanSplittedData(commitMessage, '-t')),
				taskStatus: _dailyReport2.default.getProjectStatus(_dailyReport2.default.getCleanSplittedData(commitMessage, '-s'))
			};
			reportDatas.push(reportData);
		}, reportDatas);

		// LETS MERGE COMMITS FOR SAME TASK, TIME SPENT IS ADDED, COMMIT MESSESS WOULD BE THE FIRST COMMIT
		var mergedCommitsDetail = [];
		for (var i = 0; i < reportDatas.length; i++) {
			for (var j = i + 1; j < reportDatas.length; j++) {
				if (reportDatas[i].taskId === reportDatas[j].taskId) {
					reportDatas[i].taskTitle = reportDatas[j].taskTitle;
					reportDatas[i].taskTimeSpent = reportDatas[i].taskTimeSpent + reportDatas[j].taskTimeSpent;
					reportDatas[j].isUnique = false;
				}
			}
			mergedCommitsDetail.push(reportDatas[i]);
		}

		// LETS REMOVE ALL THE NON-UNIQUE TASKS
		var finalCommitsReport = [];
		_lodash2.default.each(mergedCommitsDetail, function (a) {
			if (a.isUnique === undefined) {
				finalCommitsReport.push(a);
			}
		});

		// REMOVE MERGED COMMITS
		var noAutoGeneratedCommitsReport = [];
		_lodash2.default.each(finalCommitsReport, function (a) {
			if (a.committedBy !== 'GitHub') {
				noAutoGeneratedCommitsReport.push(a);
			}
		});
		successFn(noAutoGeneratedCommitsReport);
	};

	var getUserList = function getUserList(repoDatas, successFn) {
		var userList = [];
		repoDatas.forEach(function (r) {
			if (_lodash2.default.get(r, 'committedBy')) {
				if (!_lodash2.default.includes(userList, r.committedBy) && r.committedBy.toLowerCase() !== 'github') {
					userList.push(r.committedBy);
				}
			}
		}, userList);
		successFn(userList);
	};

	var onSuccess = function onSuccess(repoDatas, res) {
		getGitCommitsReport(repoDatas, function (commits) {
			getUserList(commits, function (userDatas) {
				var commitsByUsers = [];
				userDatas.forEach(function (a) {
					var newObject = {
						'user': a,
						'commits': []
					};
					var counter = 1;
					var totalTimeSpent = 0;

					commits.forEach(function (r) {
						totalTimeSpent += r.taskTimeSpent / 60;
						if (a === r.committedBy) {
							r.id = counter++;
							newObject['commits'].push(r);
							newObject['totalTime'] = Math.round(totalTimeSpent);
						}
					}, newObject);
					commitsByUsers.push(newObject);
				}, commitsByUsers);

				res.send({ 'commitsByUsers': commitsByUsers, "repoDatas": repoDatas });
			});
		}, function (data) {
			res.send('Error: ' + data);
		});
	};

	return {
		post: post
	};
};

exports.default = dailyReportController;
//# sourceMappingURL=dailyReport.controller.js.map