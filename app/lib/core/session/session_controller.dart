import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:secret_friend/core/network/secret_friend_api.dart';

final secretFriendApiProvider = Provider<SecretFriendApi>((ref) {
  final api = SecretFriendApi();
  ref.onDispose(() => api.clearTokens());
  return api;
});

final sessionControllerProvider = Provider<SessionController>((ref) {
  final controller = SessionController(ref.watch(secretFriendApiProvider));
  unawaited(controller.restore());
  ref.onDispose(controller.dispose);
  return controller;
});

enum AppStage { loading, signedOut, profileRequired, ready }

class SessionController extends ChangeNotifier {
  SessionController(this.api);

  final SecretFriendApi api;
  AppStage stage = AppStage.loading;
  Map<String, dynamic>? me;
  String? error;

  Future<void> restore() async {
    try {
      await api.restoreTokens();
      if (!api.hasSession) {
        stage = AppStage.signedOut;
      } else {
        await loadMe();
      }
    } catch (exception) {
      error = api.errorMessage(exception);
      await api.clearTokens();
      stage = AppStage.signedOut;
    }
    notifyListeners();
  }

  Future<void> sendOtp(String mobile) async {
    error = null;
    notifyListeners();
    try {
      await api.request<void>(
        '/auth/send-otp',
        method: 'POST',
        data: {'mobile': mobile},
        authenticated: false,
      );
    } catch (exception) {
      error = api.errorMessage(exception);
      rethrow;
    } finally {
      notifyListeners();
    }
  }

  Future<void> verifyOtp(String mobile, String code) async {
    error = null;
    notifyListeners();
    try {
      final response = await api.request<Map<String, dynamic>>(
        '/auth/verify-otp',
        method: 'POST',
        data: {'mobile': mobile, 'code': code},
        authenticated: false,
      );
      final payload = response.data;
      final accessToken = payload?['accessToken'];
      final refreshToken = payload?['refreshToken'];
      if (accessToken is! String || refreshToken is! String) {
        throw const FormatException('Invalid sign-in response from the server');
      }
      await api.saveTokens(
        accessToken: accessToken,
        refreshToken: refreshToken,
      );
      await loadMe();
    } catch (exception) {
      error = api.errorMessage(exception);
      rethrow;
    } finally {
      notifyListeners();
    }
  }

  Future<void> loadMe() async {
    final response = await api.request<Map<String, dynamic>>('/me');
    me = response.data;
    final profile = me?['profile'];
    final nickname = profile is Map<String, dynamic> ? profile['nickname'] : null;
    stage = nickname is String && nickname.isNotEmpty
        ? AppStage.ready
        : AppStage.profileRequired;
    notifyListeners();
  }

  Future<void> saveProfile(Map<String, dynamic> profile) async {
    error = null;
    try {
      await api.request<void>(
        '/me/profile',
        method: 'PUT',
        data: profile,
      );
      await loadMe();
    } catch (exception) {
      error = api.errorMessage(exception);
      rethrow;
    } finally {
      notifyListeners();
    }
  }

  Future<void> logout() async {
    final refreshToken = api.refreshToken;
    if (refreshToken != null) {
      try {
        await api.request<void>(
          '/auth/logout',
          method: 'POST',
          data: {'refreshToken': refreshToken},
          authenticated: false,
        );
      } on DioException {
        // Clear local credentials even when the server cannot be reached.
      }
    }
    await api.clearTokens();
    me = null;
    error = null;
    stage = AppStage.signedOut;
    notifyListeners();
  }
}
