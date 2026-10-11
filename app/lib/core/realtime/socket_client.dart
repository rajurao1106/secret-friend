import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

final socketClientProvider = Provider<io.Socket>((ref) {
  final socket = io.io(
    const String.fromEnvironment(
      'API_BASE_URL',
      defaultValue: 'http://127.0.0.1:3001',
    ),
    io.OptionBuilder()
        .setTransports(['websocket'])
        .disableAutoConnect()
        .build(),
  );

  ref.onDispose(socket.dispose);
  return socket;
});
