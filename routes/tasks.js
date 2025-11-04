// Load required packages
var Task = require('../models/task');
var User = require('../models/user');

function parseQueryParams(req, defaultLimit) {
    var query = {};
    var options = {};

    // Parse 'where' or 'filter' parameter
    if (req.query.where) {
        try {
            var whereParam = typeof req.query.where === 'string' ? req.query.where : JSON.stringify(req.query.where);
            query = JSON.parse(whereParam);
        } catch (e) {
            return { error: 'Invalid where parameter. Must be valid JSON.' };
        }
    } else if (req.query.filter) {
        try {
            var filterParam;
            if (typeof req.query.filter === 'string') {
                filterParam = JSON.parse(req.query.filter);
            } else {
                filterParam = req.query.filter;
            }
            
            var isProjection = true;
            for (var key in filterParam) {
                if (filterParam.hasOwnProperty(key)) {
                    var val = filterParam[key];
                    if (typeof val !== 'number' || (val !== 1 && val !== 0)) {
                        isProjection = false;
                        break;
                    }
                }
            }
            if (isProjection && Object.keys(filterParam).length > 0) {
                options.select = filterParam;
            } else {
                query = filterParam;
            }
        } catch (e) {
            return { error: 'Invalid filter parameter. Must be valid JSON.' };
        }
    }

    // Parse 'sort' parameter
    if (req.query.sort) {
        try {
            options.sort = JSON.parse(req.query.sort);
        } catch (e) {
            return { error: 'Invalid sort parameter. Must be valid JSON.' };
        }
    }

    // Parse 'select' parameter
    if (req.query.select) {
        try {
            options.select = JSON.parse(req.query.select);
        } catch (e) {
            return { error: 'Invalid select parameter. Must be valid JSON.' };
        }
    }

    // Parse 'skip' parameter
    if (req.query.skip) {
        options.skip = parseInt(req.query.skip);
        if (isNaN(options.skip)) {
            return { error: 'Invalid skip parameter. Must be a number.' };
        }
    }

    // Parse 'limit' parameter
    if (req.query.limit) {
        options.limit = parseInt(req.query.limit);
        if (isNaN(options.limit)) {
            return { error: 'Invalid limit parameter. Must be a number.' };
        }
    } else if (defaultLimit !== undefined) {
        options.limit = defaultLimit;
    }

    // Parse 'count' parameter
    var count = req.query.count === 'true';

    return { query, options, count };
}

function sendSuccess(res, statusCode, message, data) {
    res.status(statusCode).json({
        message: message,
        data: data
    });
}

function sendError(res, statusCode, message, data) {
    res.status(statusCode).json({
        message: message,
        data: data || null
    });
}

module.exports = function (router) {
    // GET /api/tasks - List all tasks
    router.route('/tasks')
        .get(function (req, res) {
            var parsed = parseQueryParams(req, 100); // default limit 100 for tasks
            if (parsed.error) {
                return sendError(res, 400, parsed.error);
            }

            var { query, options, count } = parsed;

            var mongooseQuery = Task.find(query);

            if (options.sort) {
                mongooseQuery.sort(options.sort);
            }

            if (options.select) {
                mongooseQuery.select(options.select);
            }

            if (options.skip) {
                mongooseQuery.skip(options.skip);
            }

            if (options.limit) {
                mongooseQuery.limit(options.limit);
            }

            if (count) {
                mongooseQuery.countDocuments().then(function (count) {
                    sendSuccess(res, 200, 'OK', count);
                }).catch(function (err) {
                    sendError(res, 500, 'Error counting tasks', err.message);
                });
            } else {
                mongooseQuery.exec().then(function (tasks) {
                    sendSuccess(res, 200, 'OK', tasks);
                }).catch(function (err) {
                    sendError(res, 500, 'Error retrieving tasks', err.message);
                });
            }
        })

        // POST /api/tasks - Create a new task
        .post(function (req, res) {
            if (!req.body.name || !req.body.deadline) {
                return sendError(res, 400, 'Task must have a name and deadline');
            }

            var task = new Task();
            task.name = req.body.name;
            task.description = req.body.description || "";
            task.deadline = req.body.deadline;
            task.completed = req.body.completed === true || req.body.completed === 'true' || false;
            task.assignedUser = req.body.assignedUser || "";
            task.assignedUserName = req.body.assignedUserName || "unassigned";

            // If assignedUser is provided but assignedUserName is not, fetch it from the user
            var fetchUserNamePromise = Promise.resolve();
            if (task.assignedUser && task.assignedUser !== "" && (!req.body.assignedUserName || req.body.assignedUserName === "unassigned")) {
                fetchUserNamePromise = User.findById(task.assignedUser).then(function (user) {
                    if (user) {
                        task.assignedUserName = user.name;
                    } else {
                        task.assignedUserName = "unassigned";
                    }
                }).catch(function () {
                    task.assignedUserName = "unassigned";
                });
            }

            fetchUserNamePromise.then(function () {
                return task.save();
            }).then(function (savedTask) {
                // If task is assigned to a user and not completed, add to user's pendingTasks
                if (savedTask.assignedUser && savedTask.assignedUser !== "" && !savedTask.completed) {
                    User.findById(savedTask.assignedUser).then(function (user) {
                        if (user) {
                            if (!user.pendingTasks.includes(savedTask._id.toString())) {
                                user.pendingTasks.push(savedTask._id.toString());
                                return user.save();
                            }
                        }
                    }).then(function () {
                        sendSuccess(res, 201, 'Task created successfully', savedTask);
                    }).catch(function (err) {
                        // Task was created, just log the error
                        console.error('Error updating user pending tasks:', err);
                        sendSuccess(res, 201, 'Task created successfully', savedTask);
                    });
                } else {
                    sendSuccess(res, 201, 'Task created successfully', savedTask);
                }
            }).catch(function (err) {
                sendError(res, 500, 'Error creating task', err.message);
            });
        });

    // GET /api/tasks/:id - Get a specific task
    router.route('/tasks/:id')
        .get(function (req, res) {
            var query = Task.findById(req.params.id);

            // Parse select parameter if present
            if (req.query.select) {
                try {
                    var select = JSON.parse(req.query.select);
                    query.select(select);
                } catch (e) {
                    return sendError(res, 400, 'Invalid select parameter. Must be valid JSON.');
                }
            }

            query.exec().then(function (task) {
                if (!task) {
                    return sendError(res, 404, 'Task not found');
                }
                sendSuccess(res, 200, 'OK', task);
            }).catch(function (err) {
                sendError(res, 500, 'Error retrieving task', err.message);
            });
        })

        // PUT /api/tasks/:id - Update a task
        .put(function (req, res) {
            if (!req.body.name || !req.body.deadline) {
                return sendError(res, 400, 'Task must have a name and deadline');
            }

            Task.findById(req.params.id).then(function (task) {
                if (!task) {
                    return sendError(res, 404, 'Task not found');
                }

                var oldAssignedUser = task.assignedUser ? task.assignedUser.toString() : "";
                var oldCompleted = task.completed;
                var newAssignedUser = req.body.assignedUser || "";
                var newAssignedUserName = req.body.assignedUserName || "unassigned";
                var newCompleted = req.body.completed === true || req.body.completed === 'true' || false;

                // If assignedUser is provided but assignedUserName is not, fetch it from the user
                var fetchUserNamePromise = Promise.resolve();
                if (newAssignedUser && newAssignedUser !== "" && (!req.body.assignedUserName || req.body.assignedUserName === "unassigned")) {
                    fetchUserNamePromise = User.findById(newAssignedUser).then(function (user) {
                        if (user) {
                            newAssignedUserName = user.name;
                        } else {
                            newAssignedUserName = "unassigned";
                        }
                    }).catch(function () {
                        newAssignedUserName = "unassigned";
                    });
                }

                return fetchUserNamePromise.then(function () {
                    task.name = req.body.name;
                    task.description = req.body.description || "";
                    task.deadline = req.body.deadline;
                    task.completed = newCompleted;
                    task.assignedUser = newAssignedUser;
                    task.assignedUserName = newAssignedUserName;
                    // Don't update dateCreated

                    return task.save();
                }).then(function (updatedTask) {
                    var taskId = updatedTask._id.toString();

                    // Remove from old user's pendingTasks if assigned user changed or task is now completed
                    if (oldAssignedUser && oldAssignedUser !== "" && 
                        (oldAssignedUser !== newAssignedUser || (newCompleted && !oldCompleted))) {
                        return User.findById(oldAssignedUser).then(function (oldUser) {
                            if (oldUser) {
                                oldUser.pendingTasks = oldUser.pendingTasks.filter(function (id) {
                                    return id.toString() !== taskId;
                                });
                                return oldUser.save();
                            }
                        }).then(function () {
                            // Add to new user's pendingTasks if assigned and not completed
                            if (newAssignedUser && newAssignedUser !== "" && !newCompleted) {
                                return User.findById(newAssignedUser).then(function (newUser) {
                                    if (newUser) {
                                        if (!newUser.pendingTasks.includes(taskId)) {
                                            newUser.pendingTasks.push(taskId);
                                            return newUser.save();
                                        }
                                    }
                                });
                            }
                        }).then(function () {
                            sendSuccess(res, 200, 'Task updated successfully', updatedTask);
                        });
                    } else if (newAssignedUser && newAssignedUser !== "" && !newCompleted && oldAssignedUser !== newAssignedUser) {
                        // Task is newly assigned or changed from unassigned
                        return User.findById(newAssignedUser).then(function (newUser) {
                            if (newUser) {
                                if (!newUser.pendingTasks.includes(taskId)) {
                                    newUser.pendingTasks.push(taskId);
                                    return newUser.save();
                                }
                            }
                        }).then(function () {
                            sendSuccess(res, 200, 'Task updated successfully', updatedTask);
                        });
                    } else {
                        sendSuccess(res, 200, 'Task updated successfully', updatedTask);
                    }
                });
            }).catch(function (err) {
                sendError(res, 500, 'Error updating task', err.message);
            });
        })

        // DELETE /api/tasks/:id - Delete a task
        .delete(function (req, res) {
            Task.findById(req.params.id).then(function (task) {
                if (!task) {
                    return sendError(res, 404, 'Task not found');
                }

                var taskId = task._id.toString();
                var assignedUser = task.assignedUser ? task.assignedUser.toString() : "";

                // Remove task from user's pendingTasks
                if (assignedUser && assignedUser !== "") {
                    return User.findById(assignedUser).then(function (user) {
                        if (user) {
                            user.pendingTasks = user.pendingTasks.filter(function (id) {
                                return id.toString() !== taskId;
                            });
                            return user.save();
                        }
                    }).then(function () {
                        return Task.findByIdAndDelete(taskId);
                    }).then(function () {
                        res.status(204).send();
                    });
                } else {
                    return Task.findByIdAndDelete(taskId).then(function () {
                        res.status(204).send();
                    });
                }
            }).catch(function (err) {
                sendError(res, 500, 'Error deleting task', err.message);
            });
        });

    return router;
};

