import { createConference } from '../conference';
import JitsiMeetJS from '../lib-jitsi-meet';
import {
    createLocalTracks,
    destroyLocalTracks
} from '../tracks';
import {
    CONNECTION_DISCONNECTED,
    CONNECTION_ESTABLISHED,
    CONNECTION_FAILED
} from './actionTypes';
import './reducer';

const JitsiConnectionEvents = JitsiMeetJS.events.connection;

/**
 * Opens new connection.
 *
 * @param {Object} config - Application config.
 * @param {string} room - The room name to use.
 * @returns {Promise<JitsiConnection>}
 */
function connect(config, room) {
    return dispatch => {
        const connection = new JitsiMeetJS.JitsiConnection(
            config.appId,
            config.token,
            {
                ...config.connection,
                bosh: config.connection.bosh + (
                    room ? ('?room=' + room) : ''
                )
            }
        );

        return new Promise(function (resolve, reject) {
            connection.addEventListener(
                JitsiConnectionEvents.CONNECTION_DISCONNECTED,
                handleConnectionDisconnected);
            connection.addEventListener(
                JitsiConnectionEvents.CONNECTION_ESTABLISHED,
                handleConnectionEstablished);
            connection.addEventListener(
                JitsiConnectionEvents.CONNECTION_FAILED,
                handleConnectionFailed);

            connection.connect();

            /**
             * Dispatches CONNECTION_DISCONNECTED action when connection is
             * disconnected.
             *
             * @param {string} message - Disconnect reason.
             * @returns {void}
             */
            function handleConnectionDisconnected(message) {
                connection.removeEventListener(
                    JitsiConnectionEvents.CONNECTION_DISCONNECTED,
                    handleConnectionDisconnected);

                dispatch(connectionDisconnected(connection, message));
            }

            /**
             * Resolves external promise when connection is established.
             *
             * @returns {void}
             */
            function handleConnectionEstablished() {
                unsubscribe();
                resolve(connection);
            }

            /**
             * Rejects external promise when connection fails.
             *
             * @param {JitsiConnectionErrors} err - Connection error.
             * @returns {void}
             */
            function handleConnectionFailed(err) {
                unsubscribe();
                console.error('CONNECTION FAILED:', err);
                reject(err);
            }

            /**
             * Unsubscribes connection instance from CONNECTION_ESTABLISHED
             * and CONNECTION_FAILED events.
             *
             * @returns {void}
             */
            function unsubscribe() {
                connection.removeEventListener(
                    JitsiConnectionEvents.CONNECTION_ESTABLISHED,
                    handleConnectionEstablished
                );
                connection.removeEventListener(
                    JitsiConnectionEvents.CONNECTION_FAILED,
                    handleConnectionFailed
                );
            }
        });
    };
}

/**
 * Create an action for when the signaling connection has been lost.
 *
 * @param {JitsiConnection} connection - The JitsiConnection which was
 * disconnected.
 * @param {string} message - Error message.
 * @returns {{
 *     type: CONNECTION_DISCONNECTED,
 *     connection: JitsiConnection,
 *     message: string
 * }}
 */
function connectionDisconnected(connection, message) {
    return {
        type: CONNECTION_DISCONNECTED,
        connection,
        message
    };
}

/**
 * Create an action for when the signaling connection has been established.
 *
 * @param {JitsiConnection} connection - JitsiConnection instance.
 * @returns {{type: CONNECTION_ESTABLISHED, connection: JitsiConnection}}
 */
function connectionEstablished(connection) {
    return {
        type: CONNECTION_ESTABLISHED,
        connection
    };
}

/**
 * Create an action for when the signaling connection could not be created.
 *
 * @param {string} error - Error message.
 * @returns {{type: CONNECTION_FAILED, error: string}}
 */
function connectionFailed(error) {
    return {
        type: CONNECTION_FAILED,
        error
    };
}

/**
 * Leaves the conference, closes the connection and destroys local tracks.
 *
 * @returns {Function}
 */
export function destroy() {
    return (dispatch, getState) => {
        const state = getState();
        const conference = state['features/base/conference'].jitsiConference;
        const connection = state['features/base/connection'];

        let promise = Promise.resolve();

        if (conference) {
            promise = conference.leave();
        }

        if (connection) {
            promise = promise
                .then(() => connection.disconnect());
        }

        // XXX Local tracks might exist without conference and connection
        // initialized, so we need to explicitly clean them here.
        return promise
            .then(() => dispatch(destroyLocalTracks()));
    };
}

/**
 * Initialize the JitsiMeetJS library, start local media, and then join
 * the named conference.
 *
 * @param {Object} config - Configuration object.
 * @param {string} room - Conference room name.
 * @returns {Function}
 */
export function init(config, room) {
    return dispatch  => {
        return JitsiMeetJS.init({})
            .then(() => {
                let localTracksPromise = dispatch(createLocalTracks());
                let connectionPromise = dispatch(connect(config, room))
                    .then(con => dispatch(connectionEstablished(con)))
                    .catch(err => dispatch(connectionFailed(err)));

                return Promise.all([ localTracksPromise, connectionPromise ]);
            })
            .then(() => dispatch(createConference(room)));
    };
}
