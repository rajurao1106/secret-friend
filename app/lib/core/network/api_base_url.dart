import 'package:flutter/foundation.dart';

const apiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: kReleaseMode
      ? 'https://secret-friend-rosy.vercel.app'
      : 'http://127.0.0.1:3001',
);
