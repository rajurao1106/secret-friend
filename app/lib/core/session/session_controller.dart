import 'dart:async';

import 'package:dio/dio.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:secret_friend/core/network/secret_friend_api.dart';

final secretFriendApiProvider = Provider<SecretFriendApi>((ref) {
  final api = SecretFriendApi();
  ref.onDispose(() => api.clearTokens());
  return api;
});

final sessionControllerProvider = Provider<SessionController>((ref) {
  final controller = SessionController(
    ref.watch(secretFriendApiProvider),
    firebaseAuth: FirebaseAuth.instance,
  );
  unawaited(controller.restore());
  ref.onDispose(controller.dispose);
  return controller;
});

enum AppStage { loading, signedOut, profileRequired, ready }

class SessionController extends ChangeNotifier {
  SessionController(this.api, {required FirebaseAuth firebaseAuth})
    : _firebaseAuth = firebaseAuth;

  final SecretFriendApi api;
  final FirebaseAuth _firebaseAuth;
  ConfirmationResult? _webConfirmation;
  String? _verificationId;
  PhoneAuthCredential? _autoVerifiedCredential;
  String? _pendingPhoneNumber;
  AppStage stage = AppStage.loading;
  Map<String, dynamic>? me;
  String? error;

  bool get canAutoVerify => _autoVerifiedCredential != null;

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
      final digits = mobile.replaceAll(RegExp(r'\D'), '');
      final nationalNumber = digits.length == 12 && digits.startsWith('91')
          ? digits.substring(2)
          : digits;
      final phoneNumber = '+91$nationalNumber';
      _webConfirmation = null;
      _verificationId = null;
      _autoVerifiedCredential = null;
      _pendingPhoneNumber = phoneNumber;

      if (kIsWeb) {
        _webConfirmation = await _firebaseAuth.signInWithPhoneNumber(
          phoneNumber,
        );
        return;
      }

      final codeSent = Completer<void>();
      await _firebaseAuth.verifyPhoneNumber(
        phoneNumber: phoneNumber,
        verificationCompleted: (credential) {
          _autoVerifiedCredential = credential;
          if (!codeSent.isCompleted) codeSent.complete();
        },
        verificationFailed: (exception) {
          if (!codeSent.isCompleted) codeSent.completeError(exception);
        },
        codeSent: (verificationId, _) {
          _verificationId = verificationId;
          if (!codeSent.isCompleted) codeSent.complete();
        },
        codeAutoRetrievalTimeout: (verificationId) {
          _verificationId = verificationId;
          if (!codeSent.isCompleted) codeSent.complete();
        },
      );
      await codeSent.future.timeout(const Duration(seconds: 120));
    } catch (exception) {
      error = _errorMessage(exception);
      rethrow;
    } finally {
      notifyListeners();
    }
  }

  Future<void> verifyOtp(String mobile, String code) async {
    error = null;
    notifyListeners();
    try {
      final phoneNumber = _pendingPhoneNumber;
      if (phoneNumber == null) {
        throw StateError('Request a verification code before confirming it.');
      }
      final enteredDigits = mobile.replaceAll(RegExp(r'\D'), '');
      final enteredNationalNumber =
          enteredDigits.length == 12 && enteredDigits.startsWith('91')
          ? enteredDigits.substring(2)
          : enteredDigits;
      if (phoneNumber != '+91$enteredNationalNumber') {
        throw StateError('The phone number changed. Request a new code.');
      }
      final UserCredential firebaseCredential;
      if (kIsWeb) {
        final confirmation = _webConfirmation;
        if (confirmation == null) {
          throw StateError('Request a verification code before confirming it.');
        }
        firebaseCredential = await confirmation.confirm(code);
      } else {
        final autoCredential = _autoVerifiedCredential;
        final verificationId = _verificationId;
        if (autoCredential != null) {
          firebaseCredential = await _firebaseAuth.signInWithCredential(
            autoCredential,
          );
        } else if (verificationId != null) {
          firebaseCredential = await _firebaseAuth.signInWithCredential(
            PhoneAuthProvider.credential(
              verificationId: verificationId,
              smsCode: code,
            ),
          );
        } else {
          throw StateError('The verification session expired. Request a new code.');
        }
      }

      final firebaseUser = firebaseCredential.user;
      if (firebaseUser == null) {
        throw StateError('Firebase did not return a signed-in user.');
      }
      final idToken = await firebaseUser.getIdToken();
      if (idToken == null || idToken.isEmpty) {
        throw StateError('Firebase did not return a sign-in token.');
      }
      final response = await api.request<Map<String, dynamic>>(
        '/auth/firebase-session',
        method: 'POST',
        data: {'idToken': idToken},
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
      error = _errorMessage(exception);
      rethrow;
    } finally {
      notifyListeners();
    }
  }

  String _errorMessage(Object exception) {
    if (exception is StateError) return exception.message;
    if (exception is FirebaseAuthException) {
      return switch (exception.code) {
        'invalid-phone-number' => 'Enter a valid mobile number.',
        'too-many-requests' || 'quota-exceeded' =>
          'SMS limit reached. Please wait and try again later.',
        'captcha-check-failed' =>
          'Phone verification could not be completed. Please retry.',
        'app-not-authorized' =>
          'This app is not configured for Firebase Phone Auth.',
        'network-request-failed' =>
          'Network error. Check your connection and try again.',
        'invalid-verification-code' =>
          'The OTP is incorrect. Check the code and try again.',
        'session-expired' =>
          'The OTP expired. Request a new verification code.',
        _ => exception.message ?? 'Phone verification failed. Please try again.',
      };
    }
    return api.errorMessage(exception);
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
    await _firebaseAuth.signOut();
    _webConfirmation = null;
    _verificationId = null;
    _autoVerifiedCredential = null;
    _pendingPhoneNumber = null;
    me = null;
    error = null;
    stage = AppStage.signedOut;
    notifyListeners();
  }
}
