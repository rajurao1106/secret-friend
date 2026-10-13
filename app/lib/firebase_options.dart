import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';

abstract final class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    final appId = kIsWeb
        ? const String.fromEnvironment('FIREBASE_WEB_APP_ID')
        : switch (defaultTargetPlatform) {
            TargetPlatform.android => const String.fromEnvironment(
              'FIREBASE_ANDROID_APP_ID',
            ),
            TargetPlatform.iOS => const String.fromEnvironment(
              'FIREBASE_IOS_APP_ID',
            ),
            _ => throw UnsupportedError(
              'Firebase Phone Auth is configured for Android, iOS, and Web only.',
            ),
          };
    const apiKey = String.fromEnvironment('FIREBASE_API_KEY');
    const messagingSenderId = String.fromEnvironment(
      'FIREBASE_MESSAGING_SENDER_ID',
    );
    const projectId = String.fromEnvironment('FIREBASE_PROJECT_ID');
    const authDomain = String.fromEnvironment('FIREBASE_AUTH_DOMAIN');

    if (appId.isEmpty ||
        apiKey.isEmpty ||
        messagingSenderId.isEmpty ||
        projectId.isEmpty) {
      throw StateError(
        'Firebase is not configured. Create app/firebase_config.json from '
        'firebase_config.example.json and pass it with '
        '--dart-define-from-file=firebase_config.json.',
      );
    }

    return FirebaseOptions(
      apiKey: apiKey,
      appId: appId,
      messagingSenderId: messagingSenderId,
      projectId: projectId,
      authDomain: authDomain.isEmpty ? null : authDomain,
    );
  }
}
