// Load required packages
var User = require('../models/user');
var Task = require('../models/task');

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

// When task is assigned/unassigned
async function updateUserPendingTasks(userId, taskId, add) {
    try {
        var user = await User.findById(userId);
        if (!user) return;

        if (add) {
            if (!user.pendingTasks.includes(taskId)) {
                user.pendingTasks.push(taskId);
                await user.save();
            }
        } else {
            user.pendingTasks = user.pendingTasks.filter(id => id.toString() !== taskId);
            await user.save();
        }
    } catch (err) {
        console.error('Error updating user pending tasks:', err);
    }
}

module.exports = function (router) {
    // GET /api/users - List all users
    router.route('/users')
        .get(function (req, res) {
            var parsed = parseQueryParams(req, undefined);
            if (parsed.error) {
                return sendError(res, 400, parsed.error);
            }

            var { query, options, count } = parsed;

            var mongooseQuery = User.find(query);

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
                    sendError(res, 500, 'Error counting users', err.message);
                });
            } else {
                mongooseQuery.exec().then(function (users) {
                    sendSuccess(res, 200, 'OK', users);
                }).catch(function (err) {
                    sendError(res, 500, 'Error retrieving users', err.message);
                });
            }
        })

        // POST /api/users - Create a new user
        .post(function (req, res) {
            if (!req.body.name || !req.body.email) {
                return sendError(res, 400, 'User must have a name and email');
            }

            // Create new user
            var user = new User();
            user.name = req.body.name;
            user.email = req.body.email;
            user.pendingTasks = req.body.pendingTasks || [];

            user.save().then(function (savedUser) {
                // If user has pendingTasks, update the tasks to point to this user
                if (savedUser.pendingTasks && savedUser.pendingTasks.length > 0) {
                    var updatePromises = savedUser.pendingTasks.map(function (taskId) {
                        return Task.findById(taskId).then(function (task) {
                            if (task) {
                                task.assignedUser = savedUser._id.toString();
                                task.assignedUserName = savedUser.name;
                                return task.save();
                            }
                        });
                    });

                    Promise.all(updatePromises).then(function () {
                        sendSuccess(res, 201, 'User created successfully', savedUser);
                    }).catch(function (err) {
                        sendError(res, 500, 'Error updating assigned tasks', err.message);
                    });
                } else {
                    sendSuccess(res, 201, 'User created successfully', savedUser);
                }
            }).catch(function (err) {
                if (err.code === 11000) {
                    sendError(res, 400, 'User with this email already exists');
                } else {
                    sendError(res, 500, 'Error creating user', err.message);
                }
            });
        });

    // GET /api/users/:id - Get a specific user
    router.route('/users/:id')
        .get(function (req, res) {
            var query = User.findById(req.params.id);

            // Parse select parameter if present
            if (req.query.select) {
                try {
                    var select = JSON.parse(req.query.select);
                    query.select(select);
                } catch (e) {
                    return sendError(res, 400, 'Invalid select parameter. Must be valid JSON.');
                }
            }

            query.exec().then(function (user) {
                if (!user) {
                    return sendError(res, 404, 'User not found');
                }
                sendSuccess(res, 200, 'OK', user);
            }).catch(function (err) {
                sendError(res, 500, 'Error retrieving user', err.message);
            });
        })

        // PUT /api/users/:id - Update a user
        .put(function (req, res) {
            if (!req.body.name || !req.body.email) {
                return sendError(res, 400, 'User must have a name and email');
            }

            User.findById(req.params.id).then(function (user) {
                if (!user) {
                    return sendError(res, 404, 'User not found');
                }

                var oldPendingTasks = user.pendingTasks.map(function (id) {
                    return id.toString();
                });
                var oldName = user.name;
                var newPendingTasks = req.body.pendingTasks || [];
                var newName = req.body.name;

                // Update user fields
                user.name = newName;
                user.email = req.body.email;
                user.pendingTasks = newPendingTasks;
                // Don't update dateCreated

                return user.save().then(function (updatedUser) {
                    // Update tasks that were removed from pendingTasks
                    var removedTasks = oldPendingTasks.filter(function (taskId) {
                        return !newPendingTasks.includes(taskId);
                    });

                    var unassignPromises = removedTasks.map(function (taskId) {
                        return Task.findById(taskId).then(function (task) {
                            if (task) {
                                task.assignedUser = "";
                                task.assignedUserName = "unassigned";
                                return task.save();
                            }
                        });
                    });

                    // Update tasks that were added to pendingTasks
                    var addedTasks = newPendingTasks.filter(function (taskId) {
                        return !oldPendingTasks.includes(taskId);
                    });

                    var assignPromises = addedTasks.map(function (taskId) {
                        return Task.findById(taskId).then(function (task) {
                            if (task) {
                                task.assignedUser = updatedUser._id.toString();
                                task.assignedUserName = updatedUser.name;
                                return task.save();
                            }
                        });
                    });

                    // If user's name changed, update all tasks assigned to this user
                    var nameUpdatePromises = [];
                    if (oldName !== newName) {
                        nameUpdatePromises.push(Task.updateMany(
                            { assignedUser: updatedUser._id.toString() },
                            { assignedUserName: newName }
                        ).exec());
                    }

                    return Promise.all([...unassignPromises, ...assignPromises, ...nameUpdatePromises]).then(function () {
                        sendSuccess(res, 200, 'User updated successfully', updatedUser);
                    });
                });
            }).catch(function (err) {
                if (err.code === 11000) {
                    sendError(res, 400, 'User with this email already exists');
                } else {
                    sendError(res, 500, 'Error updating user', err.message);
                }
            });
        })

        // DELETE /api/users/:id - Delete a user
        .delete(function (req, res) {
            User.findById(req.params.id).then(function (user) {
                if (!user) {
                    return sendError(res, 404, 'User not found');
                }

                var userId = user._id.toString();
                var pendingTasks = user.pendingTasks || [];

                // Unassign all pending tasks
                var unassignPromises = pendingTasks.map(function (taskId) {
                    return Task.findById(taskId).then(function (task) {
                        if (task) {
                            task.assignedUser = "";
                            task.assignedUserName = "unassigned";
                            return task.save();
                        }
                    });
                });

                return Promise.all(unassignPromises).then(function () {
                    return User.findByIdAndDelete(userId);
                }).then(function () {
                    res.status(204).send();
                });
            }).catch(function (err) {
                sendError(res, 500, 'Error deleting user', err.message);
            });
        });

    return router;
};

