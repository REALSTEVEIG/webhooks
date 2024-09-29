import { google } from 'googleapis';
import { v4 } from 'uuid';
import { type Types } from 'mongoose';
import { GoogleSubscriptionModel, UsersModel } from '@/models';
import { OAUTH } from '@/config';
import { getEnvironmentVariable } from '@/utils';

const appSettings = {
  clientId: OAUTH.GOOGLE.CLIENT_ID,
  clientSecret: OAUTH.GOOGLE.CLIENT_SECRET,
  authCallbackUri: OAUTH.GOOGLE.AUTH_URL,
  scopes: [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'openid',
  ],
  eventsWatcherUrl: OAUTH.GOOGLE.EVENTS_WATCH_URL,
  installationUrl: '',
  oauthPlayTemplate: OAUTH.GOOGLE.GOOGLE_OAUTH_PLAY_TEMPLATE,
};

const getAllCalendars = async (authClient: any): Promise<any> => {
  const calendar = google.calendar({ version: 'v3', auth: authClient });

  try {
    const calendarList = await calendar.calendarList.list();
    return calendarList.data.items;
  } catch (error: any) {
    throw new Error(error);
  }
};

const refreshAccessToken = async (refreshToken: string): Promise<any> => {
  const authClient = new google.auth.OAuth2(
    appSettings.clientId,
    appSettings.clientSecret,
    appSettings.authCallbackUri,
  );

  authClient.setCredentials({ refresh_token: refreshToken });

  const { credentials } = await authClient.refreshAccessToken();
  return credentials;
};

export const createWatchForAllCalendars = async (
  accessToken: string,
  refreshToken: string,
  user?: string,
  _id?: Types.ObjectId,
): Promise<any> => {
  const authClient = new google.auth.OAuth2();
  authClient.setCredentials({ access_token: accessToken });

  let userId: Types.ObjectId | undefined;

  if (user) {
    const userdetails = await UsersModel.findOne({ email: user });

    userId = userdetails?._id;
  }

  if (_id) {
    userId = _id;
  }

  const calendars = await getAllCalendars(authClient);

  const env = getEnvironmentVariable('NODE_ENV');

  const notificationUrl =
    env === 'development'
      ? 'https://e6f4-102-89-23-183.ngrok-free.app/api/marketplace/google-calendar/webhook'
      : 'https://api.dev.calen360.com/api/marketplace/google-calendar/webhook';

  const watchPromises = calendars.map(async (calendar: any) => {
    const randomString = v4();

    const watchRequest = {
      id: randomString,
      type: 'web_hook',
      address: notificationUrl,
    };

    try {
      const calendarApi = google.calendar({ version: 'v3', auth: authClient });

      // Set up a watch for each calendar
      const response = await calendarApi.events.watch({
        calendarId: calendar.id, // Watch for each specific calendar by its ID
        requestBody: watchRequest,
      });

      const { id, resourceId, expiration } = response.data;

      await GoogleSubscriptionModel.create({
        subscriptionId: id,
        resourceId,
        expirationDateTime: new Date(Number(expiration)),
        accessToken,
        refreshToken,
        userId,
      });

      return response.data;
    } catch (error: any) {
      throw new Error(error);
    }
  });

  return Promise.all(watchPromises);
};

export const renewWatch = async (): Promise<any> => {
  const previousWatches = await GoogleSubscriptionModel.find();

  if (!previousWatches.length) {
    return;
  }

  // Stop all previous watches before deleting subscriptions
  const stopWatchPromises = previousWatches.map(async (previousWatch) => {
    const authClient = new google.auth.OAuth2();
    authClient.setCredentials({ access_token: previousWatch.accessToken });

    const calendar = google.calendar({ version: 'v3', auth: authClient });

    try {
      // Stop the previous watch
      await calendar.channels.stop({
        auth: authClient,
        requestBody: {
          id: previousWatch.subscriptionId,
          resourceId: previousWatch.resourceId,
        },
      });
    } catch (error: any) {
      // eslint-disable-next-line no-console
      console.error(
        `Failed to stop watch for resourceId: ${previousWatch.resourceId}`,
        error,
      );
    }
  });

  await Promise.all(stopWatchPromises);

  // Delete all previous subscriptions before creating new ones
  await GoogleSubscriptionModel.deleteMany();

  // Group subscriptions by user to avoid refreshing the token for each calendar
  const subscriptionsByUser = previousWatches.reduce<Record<string, any[]>>(
    (acc, sub) => {
      acc[sub.resourceId] = acc[sub.resourceId] || [];
      acc[sub.resourceId].push(sub);
      return acc;
    },
    {},
  );

  const subscriptionPromises = Object.keys(subscriptionsByUser).map(
    async (user) => {
      const userSubscriptions = subscriptionsByUser[user];
      const { userId, refreshToken } = userSubscriptions[0];

      if (!userId) {
        return;
      }

      // Refresh access token once for each user
      const newCredentials = await refreshAccessToken(refreshToken);
      const { access_token: accessToken, refresh_token: newRefreshToken } =
        newCredentials;

      // Create a new watch for each calendar of the user
      await createWatchForAllCalendars(
        accessToken,
        newRefreshToken,
        userId,
        userId,
      );
    },
  );

  await Promise.all(subscriptionPromises);
};
