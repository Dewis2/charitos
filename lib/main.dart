import 'package:flutter/material.dart';

void main() {
  runApp(const MainApp());
}

class MainApp extends StatelessWidget {
  const MainApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: "Charito's",
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF8D4B3A),
          primary: const Color(0xFF8D4B3A),
          secondary: const Color(0xFFE9B7A3),
          surface: Colors.white,
          background: const Color(0xFFF7F2EF),
        ),
        scaffoldBackgroundColor: const Color(0xFFF7F2EF),
        textTheme: const TextTheme(
          headlineMedium: TextStyle(
            fontWeight: FontWeight.w700,
            color: Color(0xFF3E2420),
          ),
          titleLarge: TextStyle(
            fontWeight: FontWeight.w700,
            color: Color(0xFF3E2420),
          ),
          titleMedium: TextStyle(
            fontWeight: FontWeight.w600,
            color: Color(0xFF5C403B),
          ),
          bodyMedium: TextStyle(
            color: Color(0xFF5C403B),
          ),
        ),
        useMaterial3: true,
      ),
      home: const CashierScreen(),
    );
  }
}

class CashierScreen extends StatelessWidget {
  const CashierScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final orderItems = [
      const _OrderItem(
        name: 'Tarta Tres Leches',
        description: 'Porción individual',
        quantity: 2,
        price: 5.50,
      ),
      const _OrderItem(
        name: 'Café Latte',
        description: 'Leche de almendra',
        quantity: 1,
        price: 3.75,
      ),
      const _OrderItem(
        name: 'Cupcake de Vainilla',
        description: 'Betún de frutos rojos',
        quantity: 3,
        price: 2.25,
      ),
    ];

    return Scaffold(
      appBar: AppBar(
        elevation: 0,
        backgroundColor: Colors.transparent,
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: const Color(0xFF8D4B3A),
                borderRadius: BorderRadius.circular(12),
              ),
              child: const Icon(
                Icons.storefront,
                color: Colors.white,
              ),
            ),
            const SizedBox(width: 12),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  "Charito's",
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                Text(
                  'Caja principal · Turno mañana',
                  style: Theme.of(context)
                      .textTheme
                      .bodyMedium
                      ?.copyWith(color: const Color(0xFF84615A)),
                ),
              ],
            ),
          ],
        ),
        actions: [
          _HeaderAction(
            icon: Icons.search,
            label: 'Buscar pedido',
            onPressed: () {},
          ),
          const SizedBox(width: 12),
          _HeaderAction(
            icon: Icons.notifications_none,
            label: 'Notificaciones',
            onPressed: () {},
          ),
          const SizedBox(width: 24),
        ],
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
          child: LayoutBuilder(
            builder: (context, constraints) {
              final isWide = constraints.maxWidth > 900;
              final orderPanel = Expanded(
                flex: isWide ? 3 : 0,
                child: _OrderPanel(orderItems: orderItems),
              );
              final paymentPanel = Expanded(
                flex: isWide ? 2 : 0,
                child: const _PaymentPanel(),
              );
              return isWide
                  ? Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        orderPanel,
                        const SizedBox(width: 24),
                        paymentPanel,
                      ],
                    )
                  : ListView(
                      children: [
                        _OrderPanel(orderItems: orderItems),
                        const SizedBox(height: 24),
                        const _PaymentPanel(),
                      ],
                    );
            },
          ),
        ),
      ),
    );
  }
}

class _OrderPanel extends StatelessWidget {
  const _OrderPanel({required this.orderItems});

  final List<_OrderItem> orderItems;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _SectionHeader(
          title: 'Pedido actual',
          subtitle: 'Mesa 4 · 11:45 AM',
          actionLabel: 'Nuevo pedido',
          onAction: () {},
        ),
        const SizedBox(height: 16),
        _OrderSummaryCard(orderItems: orderItems),
        const SizedBox(height: 24),
        _SectionHeader(
          title: 'Productos destacados',
          subtitle: 'Accesos rápidos para la caja',
          actionLabel: 'Ver catálogo',
          onAction: () {},
        ),
        const SizedBox(height: 16),
        const _QuickItemsGrid(),
      ],
    );
  }
}

class _OrderSummaryCard extends StatelessWidget {
  const _OrderSummaryCard({required this.orderItems});

  final List<_OrderItem> orderItems;

  @override
  Widget build(BuildContext context) {
    final subtotal = orderItems.fold<double>(
      0,
      (sum, item) => sum + item.price * item.quantity,
    );
    const taxRate = 0.18;
    final taxes = subtotal * taxRate;
    final total = subtotal + taxes;

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.06),
            blurRadius: 20,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                'Orden #241',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const Spacer(),
              _StatusPill(
                label: 'En preparación',
                color: const Color(0xFFFFE4CF),
                textColor: const Color(0xFFB0612B),
              ),
            ],
          ),
          const SizedBox(height: 16),
          ...orderItems
              .map(
                (item) => Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 8,
                        ),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF1E7E3),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Text(
                          '${item.quantity}x',
                          style: const TextStyle(
                            fontWeight: FontWeight.w700,
                            color: Color(0xFF8D4B3A),
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              item.name,
                              style: Theme.of(context).textTheme.titleMedium,
                            ),
                            Text(
                              item.description,
                              style: Theme.of(context)
                                  .textTheme
                                  .bodyMedium
                                  ?.copyWith(color: const Color(0xFF84615A)),
                            ),
                          ],
                        ),
                      ),
                      Text(
                        _currency(item.price * item.quantity),
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                    ],
                  ),
                ),
              )
              .toList(),
          const Divider(height: 32),
          _PriceRow(label: 'Subtotal', amount: subtotal),
          const SizedBox(height: 8),
          _PriceRow(label: 'Impuestos (18%)', amount: taxes),
          const SizedBox(height: 8),
          _PriceRow(
            label: 'Total a cobrar',
            amount: total,
            isEmphasis: true,
          ),
        ],
      ),
    );
  }
}

class _PaymentPanel extends StatelessWidget {
  const _PaymentPanel();

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _SectionHeader(
          title: 'Cobro rápido',
          subtitle: 'Selecciona el método de pago',
          actionLabel: 'Dividir cuenta',
          onAction: () {},
        ),
        const SizedBox(height: 16),
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(20),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.06),
                blurRadius: 20,
                offset: const Offset(0, 8),
              ),
            ],
          ),
          child: Column(
            children: [
              _PaymentOption(
                icon: Icons.credit_card,
                title: 'Tarjeta',
                subtitle: 'Visa, MasterCard, Amex',
                color: const Color(0xFF8D4B3A),
                onPressed: () {},
              ),
              const SizedBox(height: 12),
              _PaymentOption(
                icon: Icons.payments_outlined,
                title: 'Efectivo',
                subtitle: 'Abrir caja y registrar cambio',
                color: const Color(0xFFB76D4C),
                onPressed: () {},
              ),
              const SizedBox(height: 12),
              _PaymentOption(
                icon: Icons.qr_code_2,
                title: 'QR / Transferencia',
                subtitle: 'Yape, Plin, Transfer',
                color: const Color(0xFF5B6F9E),
                onPressed: () {},
              ),
              const SizedBox(height: 20),
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: const Color(0xFFF7F2EF),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Column(
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.person_outline),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'Cliente: Valeria Ramírez',
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                        ),
                        TextButton(
                          onPressed: () {},
                          child: const Text('Editar'),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        const Icon(Icons.local_offer_outlined),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'Cupón activo: DULCE10 (10% off)',
                            style: Theme.of(context).textTheme.bodyMedium,
                          ),
                        ),
                        TextButton(
                          onPressed: () {},
                          child: const Text('Cambiar'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 24),
        _SectionHeader(
          title: 'Acciones rápidas',
          subtitle: 'Herramientas para el cajero',
          actionLabel: 'Personalizar',
          onAction: () {},
        ),
        const SizedBox(height: 16),
        const _ActionGrid(),
      ],
    );
  }
}

class _QuickItemsGrid extends StatelessWidget {
  const _QuickItemsGrid();

  @override
  Widget build(BuildContext context) {
    final items = [
      _QuickItemData('Croissant', 'S/ 4.20', Icons.bakery_dining),
      _QuickItemData('Pie de manzana', 'S/ 6.00', Icons.pie_chart),
      _QuickItemData('Té chai', 'S/ 3.40', Icons.emoji_food_beverage),
      _QuickItemData('Galletas', 'S/ 2.80', Icons.cookie_outlined),
    ];

    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        crossAxisSpacing: 16,
        mainAxisSpacing: 16,
        childAspectRatio: 3.4,
      ),
      itemCount: items.length,
      itemBuilder: (context, index) {
        final item = items[index];
        return Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFFE6D7D1)),
          ),
          child: Row(
            children: [
              CircleAvatar(
                backgroundColor: const Color(0xFFF1E7E3),
                child: Icon(item.icon, color: const Color(0xFF8D4B3A)),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      item.title,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    Text(
                      item.price,
                      style: Theme.of(context)
                          .textTheme
                          .bodyMedium
                          ?.copyWith(color: const Color(0xFF84615A)),
                    ),
                  ],
                ),
              ),
              IconButton(
                onPressed: () {},
                icon: const Icon(Icons.add_circle_outline),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _ActionGrid extends StatelessWidget {
  const _ActionGrid();

  @override
  Widget build(BuildContext context) {
    final actions = [
      _ActionData('Reimprimir', Icons.print_outlined),
      _ActionData('Reportes', Icons.bar_chart_outlined),
      _ActionData('Cortesía', Icons.card_giftcard_outlined),
      _ActionData('Inventario', Icons.inventory_2_outlined),
    ];

    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        crossAxisSpacing: 16,
        mainAxisSpacing: 16,
        childAspectRatio: 3.4,
      ),
      itemCount: actions.length,
      itemBuilder: (context, index) {
        final action = actions[index];
        return Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFFE6D7D1)),
          ),
          child: Row(
            children: [
              CircleAvatar(
                backgroundColor: const Color(0xFFF1E7E3),
                child: Icon(action.icon, color: const Color(0xFF8D4B3A)),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  action.title,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              IconButton(
                onPressed: () {},
                icon: const Icon(Icons.arrow_forward_ios, size: 16),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({
    required this.title,
    required this.subtitle,
    required this.actionLabel,
    required this.onAction,
  });

  final String title;
  final String subtitle;
  final String actionLabel;
  final VoidCallback onAction;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: Theme.of(context).textTheme.headlineMedium,
              ),
              const SizedBox(height: 4),
              Text(
                subtitle,
                style: Theme.of(context)
                    .textTheme
                    .bodyMedium
                    ?.copyWith(color: const Color(0xFF84615A)),
              ),
            ],
          ),
        ),
        TextButton.icon(
          onPressed: onAction,
          icon: const Icon(Icons.add),
          label: Text(actionLabel),
          style: TextButton.styleFrom(
            foregroundColor: const Color(0xFF8D4B3A),
          ),
        ),
      ],
    );
  }
}

class _PaymentOption extends StatelessWidget {
  const _PaymentOption({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.color,
    required this.onPressed,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final Color color;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onPressed,
      borderRadius: BorderRadius.circular(16),
      child: Ink(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: const Color(0xFFE6D7D1)),
        ),
        child: Row(
          children: [
            CircleAvatar(
              backgroundColor: color.withOpacity(0.15),
              child: Icon(icon, color: color),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  Text(
                    subtitle,
                    style: Theme.of(context)
                        .textTheme
                        .bodyMedium
                        ?.copyWith(color: const Color(0xFF84615A)),
                  ),
                ],
              ),
            ),
            const Icon(Icons.arrow_forward_ios, size: 16),
          ],
        ),
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({
    required this.label,
    required this.color,
    required this.textColor,
  });

  final String label;
  final Color color;
  final Color textColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        label,
        style: TextStyle(fontWeight: FontWeight.w600, color: textColor),
      ),
    );
  }
}

class _PriceRow extends StatelessWidget {
  const _PriceRow({
    required this.label,
    required this.amount,
    this.isEmphasis = false,
  });

  final String label;
  final double amount;
  final bool isEmphasis;

  @override
  Widget build(BuildContext context) {
    final style = isEmphasis
        ? Theme.of(context)
            .textTheme
            .titleLarge
            ?.copyWith(color: const Color(0xFF3E2420))
        : Theme.of(context)
            .textTheme
            .bodyMedium
            ?.copyWith(color: const Color(0xFF5C403B));

    return Row(
      children: [
        Text(label, style: style),
        const Spacer(),
        Text(_currency(amount), style: style),
      ],
    );
  }
}

class _HeaderAction extends StatelessWidget {
  const _HeaderAction({
    required this.icon,
    required this.label,
    required this.onPressed,
  });

  final IconData icon;
  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return TextButton.icon(
      onPressed: onPressed,
      icon: Icon(icon, color: const Color(0xFF8D4B3A)),
      label: Text(label),
      style: TextButton.styleFrom(
        foregroundColor: const Color(0xFF8D4B3A),
        textStyle: const TextStyle(fontWeight: FontWeight.w600),
      ),
    );
  }
}

String _currency(double value) {
  return 'S/ ${value.toStringAsFixed(2)}';
}

class _OrderItem {
  const _OrderItem({
    required this.name,
    required this.description,
    required this.quantity,
    required this.price,
  });

  final String name;
  final String description;
  final int quantity;
  final double price;
}

class _QuickItemData {
  const _QuickItemData(this.title, this.price, this.icon);

  final String title;
  final String price;
  final IconData icon;
}

class _ActionData {
  const _ActionData(this.title, this.icon);

  final String title;
  final IconData icon;
}
