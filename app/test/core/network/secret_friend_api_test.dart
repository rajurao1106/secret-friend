import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:secret_friend/core/network/secret_friend_api.dart';

void main() {
  final api = SecretFriendApi();

  test('explains Vercel function failures and includes the request ID', () {
    final error = DioException(
      requestOptions: RequestOptions(path: '/auth/send-otp'),
      response: Response<dynamic>(
        requestOptions: RequestOptions(path: '/auth/send-otp'),
        statusCode: 500,
        data: {'error': 'INTERNAL_FUNCTION_INVOCATION_FAILED'},
        headers: Headers.fromMap({
          'x-vercel-id': ['bom1::abc-123'],
        }),
      ),
    );

    final message = api.errorMessage(error);

    expect(message, contains('Server error (500).'));
    expect(message, contains('backend function failed'));
    expect(message, contains('Runtime Logs'));
    expect(message, contains('INTERNAL_FUNCTION_INVOCATION_FAILED'));
    expect(message, contains('Request ID: bom1::abc-123'));
  });

  test('keeps actionable API validation errors', () {
    final error = DioException(
      requestOptions: RequestOptions(path: '/auth/send-otp'),
      response: Response<dynamic>(
        requestOptions: RequestOptions(path: '/auth/send-otp'),
        statusCode: 400,
        data: {'error': 'Invalid Indian mobile number'},
      ),
    );

    expect(api.errorMessage(error), 'Invalid Indian mobile number');
  });

  test('distinguishes a server connection timeout', () {
    final error = DioException(
      requestOptions: RequestOptions(path: '/auth/send-otp'),
      type: DioExceptionType.connectionTimeout,
    );

    expect(
      api.errorMessage(error),
      contains('Could not connect to the backend at'),
    );
    expect(
      api.errorMessage(error),
      contains('/health to check whether it is online.'),
    );
  });
}
