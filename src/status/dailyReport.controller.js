import { Router } from 'express';
import axios from 'axios';
import _ from 'lodash';
import moment from 'moment';
import dailyReportService from './dailyReport.service';

const router = Router();
/**
 * @swagger
 * definitions:
 *   Status:
 *     properties:
 *       username:
 *         type: string
 *       reponame:
 *         type: string
 *       token:
 *         type: string
 *       date:
 *         type: string
 */

/**
 * @swagger
 * /api/status:
 *   post:
 *     tags:
 *       - Report Generator
 *     description: Lists Github commits based on given date
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: payload
 *         description: Github commits
 *         in: body
 *         required: true
 *         schema:
 *           $ref: '#/definitions/Status'
 *     responses:
 *       200:
 *         description: Successfully Listed
 */

router.post('/', (req, res) => {
	let query = req.body;
	let url = 'https://api.github.com/repos/' + query.username + '/' + query.reponame + '/events?per_page=300';
	axios.get(url,
		{
			method: 'GET',
			headers: { 'Authorization': 'token ' + query.token }
		}
	).then((data) => {
		if (data.status === 200) {
			let commits = _.get(data, 'data');
			let repoDatas = [];
			let promises = [];

			commits.forEach((c) => {
				let createdDate = moment(c.created_at).format('YYYY-MM-DD');
				let queryDate = moment(query.date).format('YYYY-MM-DD');
				let repoData = {};

				//IF PUSHEVENT TYPE
				if (createdDate === queryDate && c.type === 'PushEvent') {
					let commit = _.get(c, 'payload.commits[0]') || [];
					if (_.get(commit, 'message').toLowerCase().indexOf('merge') === -1) {
						let repoData = {
							commitMessage: commit.message,
							committedBy: commit.author.email,
							committedDate: c.created_at
						};
						repoDatas.push(repoData);
					}
				}

				//IF PULLREQUESTEVENT TYPE
				if (createdDate === queryDate && c.type === 'PullRequestEvent') {
					promises.push(axios.get(_.get(c.payload.pull_request, 'commits_url'),
						{
							method: 'GET',
							isArray: true,
							headers: { 'Authorization': 'token ' + query.token }
						}
					));
				}
			}, repoDatas);

			axios.all(promises)
				.then((result) => {
					result.forEach((data) => {
						let results = data.data;
						let repoData = {
							commitMessage: results[0].commit.message,
							committedBy: results[0].commit.author.email,
							committedDate: results[0].commit.author.date
						};
						repoDatas.push(repoData);
					}, this);
					onSuccess(repoDatas, res);
				});
		} else {
			res.send({ 'error': 'Unable to fetch data!' + data });
		}
	}).catch((data) => {
		res.send({ 'error': 'Unable to fetch data!' + data });
	});
});

const getGitCommitsReport = (repoDatas, successFn) => {
	let reportDatas = [];
	repoDatas.forEach((c) => {
		let commitMessage = _.get(c, 'commitMessage') || '';
		let reportData = {
			committedBy: c.committedBy || '',
			committedDate: c.committedDate || '',
			taskId: dailyReportService.getCleanSplittedData(commitMessage, 'space'),
			taskTitle: dailyReportService.getCleanSplittedData(commitMessage, '-m'),
			taskTimeSpent: dailyReportService.getTimeInMins(dailyReportService.getCleanSplittedData(commitMessage, '-t')),
			taskStatus: dailyReportService.getProjectStatus(dailyReportService.getCleanSplittedData(commitMessage, '-s'))
		};
		reportDatas.push(reportData);
	}, reportDatas);

	// LETS MERGE COMMITS FOR SAME TASK, TIME SPENT IS ADDED, COMMIT MESSESS WOULD BE THE FIRST COMMIT
	let mergedCommitsDetail = [];
	for (let i = 0; i < reportDatas.length; i++) {
		for (let j = i + 1; j < reportDatas.length; j++) {
			if (reportDatas[i].taskId === reportDatas[j].taskId) {
				reportDatas[i].taskTitle = reportDatas[j].taskTitle;
				reportDatas[i].taskTimeSpent = reportDatas[i].taskTimeSpent + reportDatas[j].taskTimeSpent;
				reportDatas[j].isUnique = false;
			}
		}
		mergedCommitsDetail.push(reportDatas[i]);
	}

	// LETS REMOVE ALL THE NON-UNIQUE TASKS
	let finalCommitsReport = [];
	_.each(mergedCommitsDetail, (a) => {
		if (a.isUnique === undefined) {
			finalCommitsReport.push(a);
		}
	});

	// REMOVE MERGED COMMITS
	let noAutoGeneratedCommitsReport = [];
	_.each(finalCommitsReport, (a) => {
		if (a.committedBy !== 'GitHub') {
			noAutoGeneratedCommitsReport.push(a);
		}
	});
	successFn(noAutoGeneratedCommitsReport);
};

const getUserList = (repoDatas, successFn) => {
	let userList = [];
	repoDatas.forEach((r) => {
		if (_.get(r, 'committedBy')) {
			if (!_.includes(userList, r.committedBy) && r.committedBy.toLowerCase() !== 'github') {
				userList.push(r.committedBy);
			}
		}
	}, userList);
	successFn(userList);
};

const onSuccess = (repoDatas, res) => {
	getGitCommitsReport(repoDatas,
		(commits) => {
			getUserList(commits, (userDatas) => {
				let commitsByUsers = [];
				userDatas.forEach((a) => {
					let newObject = {
						'user': a,
						'commits': []
					};
					let counter = 1;
					let totalTimeSpent = 0;

					commits.forEach((r) => {
						totalTimeSpent += (r.taskTimeSpent / 60);
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
		},
		(data) => {
			res.send('Error: ' + data);
		});
};

export default router;