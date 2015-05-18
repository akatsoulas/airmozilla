/* global $ angular console document */


angular.module('new.controllers', ['new.services'])

.filter('filesize', function () {
    return humanFileSize;
})

.directive('stopEvent', function () {
    return {
        restrict: 'A',
        link: function (scope, element, attr) {
            element.bind(attr.stopEvent, function (e) {
                e.stopPropagation();
                e.preventDefault();
            });
        }
    };
 })

.directive('loading', function() {
    return {
        restrict: 'E',
        scope: {
            on: '=',  // two-way
            size: '@', // one-way
            message: '@'
        },
        template: '<div ng-show="ld.on" ng-class="ld.outerClass">' +
                  '  <p class="loading">' +
                  '  {{ ld.message }}' +
                  '  </p>' +
                  '</div>',
        controllerAs: 'ld',
        controller: function($scope) {
            this.message = $scope.message;
            this.on = $scope.on;
            $scope.$watch('on', function (val) {
                this.on = val;
            }.bind(this));
            var size = $scope.size || 'large';
            this.outerClass = 'loading-outer-' + size;
        }
    };
})

.controller('StartController', ['$scope', '$http', '$state',
    function($scope, $http, $state) {
        var $appContainer = angular.element('#content');
        var yoursUrl = $appContainer.data('yours-url');
        var deleteUrl = $appContainer.data('delete-url');
        var videoUrl = $appContainer.data('video-url');
        var archiveUrl = $appContainer.data('archive-url');
        var scrapeUrl = $appContainer.data('screencaptures-url');
        var eventUrl = $appContainer.data('event-url');
        $scope.loading = true;

        $http.get(yoursUrl)
        .success(function(response) {
            $scope.events = response.events;
            $scope.events.forEach(function(event) {
                var nextUrl;
                if (event.title) {
                    if (event.picture) {
                        nextUrl = $state.href('summary', {id: event.id});
                    } else {
                        nextUrl = $state.href('picture', {id: event.id});
                    }
                } else {
                    nextUrl = $state.href('details', {id: event.id});
                }
                event._modifiedFormatted = moment(event.modified)
                    .format('ddd, MMM D, YYYY, h:mma UTCZZ');
                event._nextUrl = nextUrl;
                event._video = null;

                var url = videoUrl.replace('0', event.id);
                $http.get(url)
                .success(function(videoResponse) {
                    event._video = videoResponse;
                    if (!videoResponse.tag) {
                        // it must have been a straggler that wasn't submitted
                        console.log('Re-archiving', event.id);
                        $http.post(archiveUrl.replace('0', event.id))
                        .success(function() {
                            $http.get(url)
                            .success(function(archiveResponse) {
                                event._video = archiveResponse;
                            });
                        });
                    }
                });

                if (!event.pictures) {
                    $http.post(scrapeUrl.replace('0', event.id))
                    .success(function(scrapeResponse) {
                        event.pictures = scrapeResponse.no_pictures;
                        $http.get(eventUrl.replace('0', event.id))
                        .success(function(eventResponse) {
                            if (eventResponse.event && eventResponse.event.picture) {
                                event.picture = eventResponse.event.picture;
                            }
                        })
                        .error(console.error.bind(console));
                    });
                }
            });
        })
        .error(console.error.bind(console))
        .finally(function() {
            $scope.loading = false;
        });

        $scope.deleteEvent = function(event) {
            event._deleting = true;
            $http.post(deleteUrl.replace('0', event.id))
            .success(function() {
                $scope.events.splice($scope.events.indexOf(event), 1);
            })
            .error(console.error.bind(console));
        };

        // If you're deliberately here, we don't need to keep remembering
        // which Id you last worked on.
        sessionStorage.removeItem('lastNewId');
    }
])


// from http://uncorkedstudios.com/blog/multipartformdata-file-upload-with-angularjs
.directive('fileModel', ['$parse', function ($parse) {
    return {
        restrict: 'A',
        link: function(scope, element, attrs) {
            var model = $parse(attrs.fileModel);
            var modelSetter = model.assign;

            element.bind('change', function(){
                scope.$apply(function(){
                    modelSetter(scope, element[0].files[0]);
                });
            });
        }
    };
}])

.controller('StatusController',
    ['$scope', 'statusService',
    function($scope, statusService) {
        $scope.status = statusService;
    }]
)

.controller('UploadProblemController',
    ['$scope', 'uploadService',
    function($scope, uploadService) {
        $scope.upload = uploadService;

        $scope.retryUpload = function() {
            uploadService.startAndProcess();
            // .then(function() {
            //     console.log("SECOND ATTEMPT AND IT WORKED");
            // })
            // .catch(function() {
            //     console.error("SECOND ATTEMPT AND IT FAILED");
            // });
        };
    }]
)

.controller('UploadController',
    ['$scope', '$http', '$state', '$interval',
     'statusService', 'eventService', 'uploadService',
    function(
        $scope, $http, $state, $interval,
        statusService, eventService, uploadService
    ) {
        $scope.fileError = null;

        var acceptedFiles = [
            'video/webm',
            'video/quicktime',
            'video/mp4',
            'video/x-flv',
            'video/ogg',
            'video/x-msvideo',
            'video/x-ms-wmv',
            'video/x-m4v'
        ];

        $scope.startUpload = function() {

            if (!$scope.dataFile) {
                return;
            }
            $scope.fileError = null;
            var file = $scope.dataFile;

            // commented out temporarily so I don't have to upload movie files every time!!!!!!
            if (acceptedFiles.indexOf(file.type) === -1) {
                $scope.fileError = 'Not a recognized file type (' +
                    file.type + ')';
                return;
            }

            // statusService.set('Uploading video file...');
            // eventService.setUploading(true);
            $state.go('preemptiveDetails');
            uploadService.setDataFile(file);
            uploadService.startAndProcess();

        };

    }
])

.controller('DetailsController',
    ['$scope', '$stateParams', '$http', '$state', '$timeout',
     'eventService', 'statusService', 'localProxy',
    function(
        $scope, $stateParams, $http, $state, $timeout,
        eventService, statusService, localProxy
    ) {
        $scope.eventService = eventService;
        var $appContainer = angular.element('#content');
        var eventUrl = $appContainer.data('event-url');
        $scope.event = {};
        $scope.errors = {};
        $scope.hasErrors = false;
        if (typeof $stateParams.id !== 'undefined') {
            eventService.setId(parseInt($stateParams.id, 10));
        } else {
            // we have to pick some defaults
            $scope.event.privacy = 'public';
        }

        function decodeChannelsList(channels) {
            // needed for angularjs
            var dict = {};
            channels.forEach(function(channel) {
                if (channel instanceof Object) {
                    dict[channel.id] = true;
                } else {
                    dict[channel] = true;
                }
            });
            return dict;
        }

        function encodeChannelsList(channels) {
            // needed for django
            var flat = [];
            for (var id in channels) {
                if (channels[id]) {
                    flat.push(id);
                }
            }
            return flat;
        }

        // $scope.loading=true;return;

        if (eventService.getId() === null && !eventService.isUploading()) {
            var lastId = sessionStorage.getItem('lastNewId');
            if (lastId) {
                $state.go('details', {id: lastId});
                sessionStorage.removeItem('lastNewId');
            } else {
                $state.go('start');
            }
        } else if (eventService.getId() === null) {
            // the upload progress is still going on
            $scope.loading = false;
        } else {
            $scope.loading = true;
            $http.get(eventUrl.replace('0', eventService.getId()))
            .success(function(response) {
                if (response.event.status !== 'initiated') {
                    $state.go('published', {id: eventService.getId()});
                }
                $scope.event = response.event;
                if ($scope.event.picture) {
                    eventService.setPicture($scope.event.picture);
                }
                // exceptional for editing
                $scope.event.channels = decodeChannelsList(
                    response.event.channels
                );
                $scope.loading = false;
                // use jQuery to find out if any of the channels you have
                // selected is in the hidden part
                $timeout(function() {
                    for (var id in $scope.event.channels) {
                        if ($('input[value="' + id + '"]:hidden').length) {
                            $scope.showOtherChannels = true;
                        }
                    }
                });
                if (!$scope.picture) {
                    // we need to "force load this"
                    eventService.scrape($scope.event.id);
                    eventService.lookForPicture($scope.event.id);
                }
            })
            .error(eventService.handleErrorStatus);

        }

        function setupTagsTextcomplete(response) {
            $('#id_tags').textcomplete([
                {
                    words: response.tags,
                    match: /\b(\w{2,})$/i,
                    search: function (term, callback) {
                        callback($.map(this.words, function (word) {
                            return word.indexOf(term) === 0 ? word : null;
                        }));
                    },
                    index: 1,
                    replace: function (word) {
                        return word + ', ';
                    }
                }
            ]);
        }

        // Run this in a timeout so that we give the template a chance
        // to render first.
        $timeout(function() {
            localProxy.get('/all-tags/', true, true)
            .then(setupTagsTextcomplete, function() {
                console.error.apply(console, arguments);
            }, setupTagsTextcomplete);
        }, 1000);

        $scope.save = function() {
            statusService.set('Saving event', 1);
            // console.log($scope.event);
            // return false;
            $scope.errors = {};
            $scope.hasErrors = false;
            // exceptionally change the channels list of a plain list
            $scope.event.channels = encodeChannelsList($scope.event.channels);
            $http.post(eventUrl.replace('0', eventService.getId()), $scope.event)
            .success(function(response) {
                if (response.errors) {
                    $scope.hasErrors = true;
                    $scope.errors = response.errors;
                    console.warn(response.errors);
                    statusService.set('Form submission error', 10);
                    $scope.event.channels = decodeChannelsList(
                        $scope.event.channels
                    );
                } else {
                    $scope.event = response.event;
                    $scope.event.channels = decodeChannelsList(
                        response.event.channels
                    );
                    statusService.set('Event saved!', 3);
                    if ($scope.event.picture) {
                        $state.go('summary', {id: eventService.getId()});
                    } else {
                        $state.go('picture', {id: eventService.getId()});
                    }
                }
            })
            .error(function() {
                console.error.apply(console, arguments);
                // decode it back
                $scope.event.channels = decodeChannelsList(
                    $scope.event.channels
                );
            });
        };

        $scope.toggleShowOtherChannels = function() {
            $scope.showOtherChannels = !$scope.showOtherChannels;
        };

    }
])

.controller('PictureController',
    ['$scope', '$stateParams', '$http', '$state', '$interval',
     'eventService', 'statusService',
    function(
        $scope, $stateParams, $http, $state, $interval,
        eventService, statusService
    ) {
        var $appContainer = angular.element('#content');
        $scope.thumbnails = [];
        $scope.picked = null;
        var id = $stateParams.id;

        var eventUrl = $appContainer.data('event-url').replace('0', id);
        var pictureUrl = $appContainer.data('picture-url').replace('0', id);
        var scrapeUrl = $appContainer.data('screencaptures-url').replace('0', id);
        var rotateUrl = $appContainer.data('rotate-url').replace('0', id);

        $http.get(eventUrl)
        .success(function(response) {
            $scope.event = response.event;
            if (response.event.status !== 'initiated') {
                $state.go('published', {id: id});
            }
        })
        .error(eventService.handleErrorStatus);

        $scope.durationError = false;
        $scope.picturesError = false;

        $scope.loading = true;
        $scope.stillLoading = false;
        var reFetching = false;
        var reloadPromise = null;
        var displayAvailableScreencaptures = function() {
            console.log('Continue to look for available screen captures');
            $http.get(pictureUrl)
            .success(function(response) {
                // console.log(response);
                if (response && response.thumbnails) {
                    $scope.loading = false;
                    $scope.stillLoading = false;
                    if (response.thumbnails.length > 1) {
                        if (reloadPromise) {
                            $interval.cancel(reloadPromise);
                        }
                    }
                    $scope.thumbnails = response.thumbnails;
                } else {
                    // statusService.set('No screen captures available yet.');
                    $scope.stillLoading = true;
                    if (response && !response.fetching && !reFetching) {
                        reFetching = true;
                        $http.post(scrapeUrl)
                        .success(function(scrapeResponse) {
                            if (!scrapeResponse.seconds) {
                                $scope.loading = false;
                                $scope.stillLoading = false;
                                $scope.durationError = true;
                                if (reloadPromise) {
                                    $interval.cancel(reloadPromise);
                                }
                            } else if (!scrapeResponse.no_pictures) {
                                $scope.loading = false;
                                $scope.stillLoading = false;
                                $scope.picturesError = true;
                                if (reloadPromise) {
                                    $interval.cancel(reloadPromise);
                                }
                            } else {
                                console.log(
                                    'Finished screencaps scraping',
                                    response
                                );
                            }
                        })
                        .error(console.error.bind(console));
                    }
                }
            })
            .error(console.error.bind(console));
        };
        displayAvailableScreencaptures(); // first load
        reloadPromise = $interval(displayAvailableScreencaptures, 3 * 1000);

        $scope.pickThumbnail = function(thumbnail) {
            // unpick the other, if there was one
            $scope.thumbnails.forEach(function(thisThumbnail) {
                thisThumbnail.picked = false;
            });
            thumbnail.picked = true;
            $http.post(pictureUrl, {picture: thumbnail.id})
            .success(function() {
                statusService.set('Chosen picture saved.', 3);
            })
            .error(console.error.bind(console));
            return false;
        };

        $scope.next = function() {
            if ($scope.event.title) {
                $state.go('summary', {id: $scope.event.id});
            } else {
                $state.go('details', {id: $scope.event.id});
            }
        };

        $scope.rotatePictures = function(direction) {
            $scope.rotating = true;
            $http.post(rotateUrl, {direction: direction})
            .finally(function() {
                displayAvailableScreencaptures();
                $scope.rotating = false;
            });
        };

    }
])

.controller('SummaryController',
    ['$scope', '$stateParams', '$http', '$state', '$sce', '$timeout',
     'statusService', 'eventService',
    function(
        $scope, $stateParams, $http, $state, $sce, $timeout,
        statusService, eventService
    ) {
        var $appContainer = angular.element('#content');
        var id = $stateParams.id;
        var url = $appContainer.data('summary-url').replace('0', id);
        var videoUrl = $appContainer.data('video-url').replace('0', id);
        var publishUrl = $appContainer.data('publish-url').replace('0', id);
        $scope.video = {};
        $scope.loading = true;
        $scope.publishing = false;
        $scope.publishingError = false;

        function showIframe() {
            var iframeUrl = $appContainer.data('iframe-url')
                .replace('slug', $scope.event.slug) +
                '?no-warning=1&no-footer=1'
                ;
            $scope.video.iframe_src = $sce.trustAsResourceUrl(iframeUrl);
        }

        function fetchVideo() {
            $http.get(videoUrl)
            .success(function(response) {
                $scope.video = response;
                if (response.finished) {
                    showIframe();
                } else {
                    $timeout(function() {
                        fetchVideo();
                        console.log('Rechecking if video is there now');
                    }, 5 * 1000);
                }
            })
            .error(console.error.bind(console))
            .finally(function() {
                $scope.loadingVideo = false;
            });
        }

        $http.get(url)
        .success(function(response) {
            if (response.event.status !== 'initiated') {
                $state.go('published', {id: id});
            }
            $scope.event = response.event;
            $scope.pictures = response.pictures;
            $scope.loadingVideo = true;
            fetchVideo();
        })
        .error(eventService.handleErrorStatus)
        .finally(function() {
            $scope.loading = false;
        });

        $scope.publish = function() {
            $scope.publishing = true;
            $scope.publishingError = false;
            $http.post(publishUrl)
            .success(function() {
                $state.go('published', {id: id});
                $scope.publishing = false;
            })
            .error(function() {
                console.error.apply(console, arguments);
                $scope.publishingError = true;
                $scope.publishing = false;
            });
        };

        $scope.resetPublishingError = function() {
            $scope.publishingError = false;
        };

    }
])

.controller('PublishedController',
    ['$scope', '$stateParams', '$http', 'eventService',
    function($scope, $stateParams, $http, eventService) {
        'use strict';
        var $appContainer = angular.element('#content');
        var id = $stateParams.id;
        var summaryUrl = $appContainer.data('summary-url').replace('0', id);
        summaryUrl += '?extended';
        var videoUrl = $appContainer.data('video-url').replace('0', id);
        $scope.video = null;
        $scope.loading = true;

        $http.get(summaryUrl)
        .success(function(response) {
            $scope.event = response.event;
            $scope.event._absURL = document.location.protocol + '//' +
            document.location.hostname +
            response.event.url;
        })
        .error(eventService.handleErrorStatus)
        .finally(function() {
            $scope.loading = false;
        });

        $http.get(videoUrl)
        .success(function(response) {
            $scope.video = response;
        })
        .error(eventService.handleErrorStatus);

    }
])

.controller('NotFoundController',
    ['$scope',
    function($scope) {
        $scope.error = {
            title: 'Not Found',
            message: 'Page not found.'
        };
    }
])

.controller('NotYoursController',
    ['$scope',
    function($scope) {
        'use strict';
        $scope.error = {
            title: 'Not Yours',
            message: 'The page you tried to access tried to access data ' +
                     'about an event that doesn\'t belong to you.'
        };
    }
])

;
