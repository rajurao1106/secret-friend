import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:secret_friend/app/app.dart';

void main() {
  runApp(const ProviderScope(child: SecretFriendApp()));
}
