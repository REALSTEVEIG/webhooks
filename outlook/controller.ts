const webHookUrl = async (req: Request, res: Response): Promise<any> => {
    try {
      const validationToken = req.query.validationToken;
      if (validationToken) {
        return res.status(200).send(validationToken);
      }
  
      const notifications = req.body.value;
      if (!Array.isArray(notifications)) {
        return res.status(400).json({ error: 'Invalid notifications format' });
      }
  
      const results = await Promise.allSettled(
        notifications.map(async (notification) => {
          const { subscriptionId } = notification;
  
          if (!subscriptionId) {
            throw new Error('Missing subscription ID');
          }
  
          const user = await OutlookSubscriptionModel.findOne({ subscriptionId });
  
          if (!user) {
            throw new Error(
              `User not found for subscription ID ${subscriptionId}`,
            );
          }
  
          await sendOutlookEventUpdates(user.userId);
        }),
      );
  
      const error = results.filter((result) => result.status === 'rejected');
  
      if (error.length > 0) {
        return res.status(207).json({
          message: 'Some notifications processed with errors',
          errors: error.map((e) => e),
        });
      }
  
      return res
        .status(200)
        .json({ message: 'Notifications processed successfully' });
    } catch (error: any) {
      return res.status(500).json({ error: 'Internal server error' });
    }
  };