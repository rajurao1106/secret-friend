import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'api_base_url.dart';

class SecretFriendApi {
  SecretFriendApi({Dio? dio, FlutterSecureStorage? secureStorage})
    : _dio =
          dio ??
          Dio(
            BaseOptions(
              baseUrl: apiBaseUrl,
              connectTimeout: const Duration(seconds: 10),
              receiveTimeout: const Duration(seconds: 15),
            ),
          ),
      _secureStorage = secureStorage ?? const FlutterSecureStorage();

  final Dio _dio;
  final FlutterSecureStorage _secureStorage;
  static const _accessTokenKey = 'secret_friend_access_token';
  static const _refreshTokenKey = 'secret_friend_refresh_token';

  String? _accessToken;
  String? _refreshToken;

  String get baseUrl => _dio.options.baseUrl;
  String? get accessToken => _accessToken;
  String? get refreshToken => _refreshToken;
  bool get hasSession => _accessToken != null && _refreshToken != null;

  Future<void> restoreTokens() async {
    _accessToken = await _secureStorage.read(key: _accessTokenKey);
    _refreshToken = await _secureStorage.read(key: _refreshTokenKey);
  }

  Future<void> saveTokens({
    required String accessToken,
    required String refreshToken,
  }) async {
    _accessToken = accessToken;
    _refreshToken = refreshToken;
    await Future.wait([
      _secureStorage.write(key: _accessTokenKey, value: accessToken),
      _secureStorage.write(key: _refreshTokenKey, value: refreshToken),
    ]);
  }

  Future<void> clearTokens() async {
    _accessToken = null;
    _refreshToken = null;
    await Future.wait([
      _secureStorage.delete(key: _accessTokenKey),
      _secureStorage.delete(key: _refreshTokenKey),
    ]);
  }

  Future<Response<T>> request<T>(
    String path, {
    String method = 'GET',
    Object? data,
    Map<String, dynamic>? queryParameters,
    Options? options,
    bool authenticated = true,
    bool retryUnauthorized = true,
  }) async {
    final mergedHeaders = <String, dynamic>{...?options?.headers};
    if (authenticated && _accessToken != null) {
      mergedHeaders['Authorization'] = 'Bearer $_accessToken';
    }

    try {
      return await _dio.request<T>(
        path,
        data: data,
        queryParameters: queryParameters,
        options: (options ?? Options()).copyWith(
          method: method,
          headers: mergedHeaders,
        ),
      );
    } on DioException catch (error) {
      if (error.response?.statusCode != 401 ||
          !authenticated ||
          !retryUnauthorized ||
          _refreshToken == null) {
        rethrow;
      }
      await _refreshSession();
      return request<T>(
        path,
        method: method,
        data: data,
        queryParameters: queryParameters,
        options: options,
        authenticated: authenticated,
        retryUnauthorized: false,
      );
    }
  }

  Future<void> _refreshSession() async {
    final token = _refreshToken;
    if (token == null) throw StateError('No refresh token is available');

    try {
      final response = await _dio.post<Map<String, dynamic>>(
        '/auth/refresh',
        data: {'refreshToken': token},
      );
      final payload = response.data;
      final accessToken = payload?['accessToken'];
      final refreshToken = payload?['refreshToken'];
      if (accessToken is! String || refreshToken is! String) {
        throw const FormatException('Invalid refresh response');
      }
      await saveTokens(accessToken: accessToken, refreshToken: refreshToken);
    } on DioException {
      await clearTokens();
      rethrow;
    }
  }

  String errorMessage(Object error) {
    if (error is DioException) {
      final response = error.response;
      if (response == null) {
        return switch (error.type) {
          DioExceptionType.connectionTimeout =>
            'Could not connect to the backend at ${_dio.options.baseUrl}.\n'
                'Open ${_dio.options.baseUrl}/health to check whether it is online.',
          DioExceptionType.receiveTimeout =>
            'The server took too long to respond. Please try again.',
          DioExceptionType.connectionError => 'Cannot connect to the server. Check your internet connection and try again.',
          _ => 'No response from the server. Please check your connection and try again.',
        };
      }

      final statusCode = response.statusCode;
      if (statusCode != null && statusCode >= 500) {
        final platformCode = _vercelErrorCode(response.data);
        final requestId =
            response.headers.value('x-vercel-id') ??
            response.headers.value('x-request-id');
        return [
          'Server error ($statusCode).',
          if (platformCode == 'INTERNAL_FUNCTION_INVOCATION_FAILED' ||
              platformCode == 'FUNCTION_INVOCATION_FAILED')
            'The backend function failed to start or crashed. Check the Vercel deployment Runtime Logs.'
          else if (platformCode == 'FUNCTION_INVOCATION_TIMEOUT')
            'The backend took too long to respond. Check the Vercel deployment Runtime Logs.'
          else
            'The backend could not complete this request. Please try again later.',
          if (platformCode != null) 'Error code: $platformCode.',
          if (requestId != null) 'Request ID: $requestId',
        ].join('\n');
      }

      final data = response.data;
      if (data is Map) {
        final message = data['error'] ?? data['message'];
        if (message is String && message.isNotEmpty) return message;
      }
      return 'Request failed (HTTP ${statusCode ?? 'unknown'}). Please try again.';
    }
    return 'Something went wrong. Please try again.';
  }

  String? _vercelErrorCode(Object? data) {
    const codes = [
      'INTERNAL_FUNCTION_INVOCATION_FAILED',
      'FUNCTION_INVOCATION_FAILED',
      'FUNCTION_INVOCATION_TIMEOUT',
    ];
    final content = data is Map
        ? data.values.join(' ')
        : data?.toString() ?? '';
    for (final code in codes) {
      if (content.contains(code)) return code;
    }
    return null;
  }
}
