/* eslint-disable import/no-cycle */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
import axios from 'axios';
import ApiError from '@/utils/api-error';
import { getEnvironmentVariable } from '@/utils';
import { OutlookSubscriptionModel } from '@/models';
import { refreshAccessTokenForGetAllEvents } from './index';

const env = getEnvironmentVariable('NODE_ENV');

const notificationUrl =
  env === 'development'
    ? 'https://e6f4-102-89-23-183.ngrok-free.app/api/marketplace/microsoft-calendar/webhook'
    : 'https://api.dev.calen360.com/api/marketplace/microsoft-calendar/webhook';

export const createSubscription = async (accessToken: string): Promise<any> => {
  try {
    const allCalendarsResponse = await axios.get(
      'https://graph.microsoft.com/v1.0/me/calendars',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    const allCalendars = allCalendarsResponse.data.value;

    const subscribeAllCalendars = await Promise.all(
      allCalendars.map(async (calendar: any) => {
        const { id } = calendar;

        const subscriptionRequest = {
          changeType: 'created,updated,deleted',
          notificationUrl,
          resource: `/me/calendars/${id}/events`,
          expirationDateTime: new Date(
            new Date().getTime() + 4230 * 60000,
          ).toISOString(),
          clientState: 'secret',
        };

        try {
          const response = await axios.post(
            'https://graph.microsoft.com/v1.0/subscriptions',
            subscriptionRequest,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
            },
          );
          return response.data;
        } catch (error: any) {
          throw new Error('Subscription creation failed');
        }
      }),
    );

    return subscribeAllCalendars;
  } catch (error) {
    throw new Error('Failed to create subscriptions');
  }
};

export const renewOutlookSubscription = async (): Promise<any> => {
  const allSubscriptions = await OutlookSubscriptionModel.find();

  const renewPromise = allSubscriptions.map(async (subscription) => {
    const { subscriptionId, refreshToken } = subscription;
    const newTokens = await refreshAccessTokenForGetAllEvents(refreshToken);

    const renewEndpoint = `https://graph.microsoft.com/v1.0/subscriptions/${subscriptionId}`;

    const newExpirationDate = new Date(
      new Date().getTime() + 4230 * 60000,
    ).toISOString();

    const renewRequest = {
      expirationDateTime: newExpirationDate,
    };

    try {
      const response = await axios.patch(renewEndpoint, renewRequest, {
        headers: {
          Authorization: `Bearer ${newTokens.newAccessToken}`,
          'Content-Type': 'application/json',
        },
      });

      await OutlookSubscriptionModel.findOneAndUpdate(
        { subscriptionId },
        { expirationDateTime: newExpirationDate },
        { new: true, runValidators: true },
      );

      return response.data;
    } catch (error: any) {
      if (error.response && error.response.status === 404) {
        throw new ApiError(error.response.data.error);
      } else {
        throw new ApiError(error.response.data.error);
      }
    }
  });

  try {
    const results = await Promise.all(renewPromise);
    return results;
  } catch (error: any) {
    if (error.response && error.response.status === 404) {
      throw new ApiError(error.response.data.error);
    } else {
      throw new ApiError(error.response.data.error);
    }
  }
};
