const googleWebhookUrl = async (req: Request, res: Response): Promise<any> => {
    try {
      const channelId = req.header('x-goog-channel-id');
      const resourceId = req.header('x-goog-resource-id');
      const resourceState = req.header('x-goog-resource-state');
      const messageNumber = req.header('x-goog-message-number');
  
      if (!channelId || !resourceId || !resourceState) {
        return res.status(400).json({ error: 'Missing required headers' });
      }
  
      // eslint-disable-next-line no-console
      console.log('Received notification', {
        channelId,
        resourceId,
        resourceState,
        messageNumber,
      });
  
      // Step 2: Find the subscription associated with the channelId
      const subscription = await GoogleSubscriptionModel.findOne({
        subscriptionId: channelId,
      });
  
      if (!subscription) {
        return res.status(404).json({ error: 'Subscription not found' });
      }
  
      const user = subscription.userId;
  
      await sendGoogleEventUpdates(user);
  
      res.status(200).json({ message: 'Notification processed successfully' });
    } catch (error: any) {
      return res.status(500).json({ error: 'Internal server error' });
    }
  };
  